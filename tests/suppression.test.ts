import { describe, expect, it } from "vitest";
import { ABUSE_TYPES, REGIONS, type IntakeRecord } from "../schema/index.js";
import { buildCrossTab, type Dimension } from "../pipeline/aggregate.js";
import { suppressTable } from "../pipeline/suppress.js";
import { findSuppressionViolations } from "../pipeline/audit.js";
import { linkedTableViolations } from "../shared/linked.js";
import { backCalculableTotalFixture, justUnderKFixture, sparseRegionFixture } from "../generator/fixtures.js";

const abuseTypeDimension: Dimension = {
  name: "abuse_type",
  labels: [...ABUSE_TYPES],
  keyOf: (r: IntakeRecord) => r.abuse_type,
};

const regionDimension: Dimension = {
  name: "region",
  labels: [...REGIONS],
  keyOf: (r: IntakeRecord) => r.region,
};

describe("suppressTable — rule 1 (no cell below k)", () => {
  it("suppresses a cell that falls just under k, and protects it without wiping out the table", () => {
    const k = 11;
    const records = justUnderKFixture(k);
    const raw = buildCrossTab(records, abuseTypeDimension, regionDimension);
    const table = suppressTable(raw, k);

    const spywareA = table.cells[table.rowLabels.indexOf("spyware")]![table.colLabels.indexOf("Region A")];
    expect(spywareA).toBeNull(); // k - 1 records: below threshold

    expect(findSuppressionViolations(table)).toEqual([]);

    // Utility sanity check: on a realistically-sized grid (6 abuse types x
    // 6 regions = 36 cells, only one of them below k), protecting that one
    // cell should suppress a handful of others, not collapse the whole
    // table — a suppressor that always hides everything would trivially
    // pass the invariant check above without actually being useful.
    const totalSuppressed = table.cells.flat().filter((v) => v === null).length;
    expect(totalSuppressed).toBeGreaterThan(0);
    expect(totalSuppressed).toBeLessThan(table.cells.flat().length / 2);
  });

  it("never suppresses a genuine zero cell", () => {
    const records = sparseRegionFixture();
    const raw = buildCrossTab(records, abuseTypeDimension, regionDimension);
    const table = suppressTable(raw, 11);

    const trackerB = table.cells[table.rowLabels.indexOf("tracker")]![table.colLabels.indexOf("Region B")];
    expect(trackerB).toBe(0);
  });

  it("holds across a large random synthetic dataset", async () => {
    const { generateIntakeRecords } = await import("../generator/index.js");
    const records = generateIntakeRecords({ seed: 99, quarters: ["2025-Q1"], totalRecords: 300 });
    const raw = buildCrossTab(records, abuseTypeDimension, regionDimension);
    const table = suppressTable(raw, 11);
    expect(findSuppressionViolations(table)).toEqual([]);
  });
});

describe("suppressTable — rule 2 (no back-calculable cell)", () => {
  it("hides a second cell when a row total would otherwise expose the one suppressed cell", () => {
    const k = 11;
    const records = backCalculableTotalFixture(k);
    const raw = buildCrossTab(records, abuseTypeDimension, regionDimension);
    const table = suppressTable(raw, k);

    const violations = findSuppressionViolations(table);
    expect(violations).toEqual([]);

    const rowIdx = table.rowLabels.indexOf("spyware");
    const suppressedInRow = table.cells[rowIdx]!.filter((v) => v === null).length;
    // Primary suppression alone would leave exactly one hidden cell in this
    // row while the row total is shown — that's the exact violation being
    // guarded against, so a fixed table must show 0 or >= 2, never 1.
    expect(suppressedInRow).not.toBe(1);
  });

  it("is internally consistent: a fully-visible row's cells sum to its shown total", () => {
    const records = sparseRegionFixture();
    const raw = buildCrossTab(records, abuseTypeDimension, regionDimension);
    const table = suppressTable(raw, 11);

    for (let i = 0; i < table.rowLabels.length; i++) {
      const row = table.cells[i]!;
      if (row.every((v) => v !== null) && table.rowTotals[i] !== null) {
        const sum = row.reduce((a, b) => a + (b ?? 0), 0);
        expect(sum).toBe(table.rowTotals[i]);
      }
    }
  });

  it("has no violations across many random seeds and thresholds", async () => {
    const { generateIntakeRecords } = await import("../generator/index.js");
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const k of [5, 11, 20]) {
        const records = generateIntakeRecords({ seed, quarters: ["2025-Q1", "2025-Q2"], totalRecords: 150 });
        const raw = buildCrossTab(records, abuseTypeDimension, regionDimension);
        const table = suppressTable(raw, k);
        expect(findSuppressionViolations(table), `seed=${seed} k=${k}`).toEqual([]);
      }
    }
  });

  it("never leaves hidden cells whose derivable sum pins them to exact values", () => {
    // Two cells of exactly 1 in one row. Zeros are never hidden, so if the row total were shown with
    // only those two hidden, "total minus shown" = 2 would prove both are exactly 1.
    const records: IntakeRecord[] = [];
    ABUSE_TYPES.forEach((abuse_type, a) => {
      REGIONS.forEach((region, r) => {
        const count = abuse_type === "spyware" && (region === "Region A" || region === "Region B") ? 1 : 40 + ((a * 11 + r * 5) % 30);
        for (let n = 0; n < count; n++) {
          records.push({ abuse_type, region, finding_detail: "unknown_or_undetermined", platform: "android", quarter: "2025-Q1", outcome: [], days_to_safety_plan: null });
        }
      });
    });
    const table = suppressTable(buildCrossTab(records, abuseTypeDimension, regionDimension), 11);
    expect(findSuppressionViolations(table)).toEqual([]);

    const i = table.rowLabels.indexOf("spyware");
    const total = table.rowTotals[i];
    if (total !== null && total !== undefined) {
      const shown = table.cells[i]!.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      expect(total - shown).toBeGreaterThanOrEqual(11);
    }
  });
});

describe("suppressTable — threshold validation", () => {
  it("refuses a threshold that would suppress nothing, instead of failing open", () => {
    const raw = buildCrossTab(sparseRegionFixture(), abuseTypeDimension, regionDimension);
    for (const k of [0, 1, 2.5, Number.NaN, -3]) {
      expect(() => suppressTable(raw, k), `k=${k}`).toThrow(/threshold/);
    }
  });
});

describe("findSuppressionViolations — catches each disclosure pattern", () => {
  const base = {
    rowDimension: "abuse_type",
    colDimension: "region",
    suppressionThreshold: 11,
  };

  it("flags hidden cells whose derivable sum is below k", () => {
    // Row: [hidden, hidden, 50] with total 52 shown -> the two hidden cells add up to 2.
    const violations = findSuppressionViolations({
      ...base,
      rowLabels: ["spyware"],
      colLabels: ["A", "B", "C"],
      cells: [[null, null, 50]],
      rowTotals: [52],
      colTotals: [null, null, 50],
      grandTotal: 52,
    });
    expect(violations.some((v) => v.includes('row "spyware"') && v.includes("sum is below k=11"))).toBe(true);
    // Messages reach logs and the page, so they never carry the value they protect.
    expect(violations.every((v) => !/\b2\b/.test(v))).toBe(true);
  });

  it("flags a hidden total recoverable as the grand total minus the other totals", () => {
    const violations = findSuppressionViolations({
      ...base,
      rowLabels: ["spyware", "image_based"],
      colLabels: ["A"],
      cells: [[50], [null]],
      rowTotals: [50, null],
      colTotals: [55],
      grandTotal: 55,
    });
    expect(violations.some((v) => v.startsWith("the row totals:") && v.includes("recoverable"))).toBe(true);
  });

  it("flags a shown total below k, not just a shown cell", () => {
    const violations = findSuppressionViolations({
      ...base,
      rowLabels: ["spyware"],
      colLabels: ["A"],
      cells: [[null]],
      rowTotals: [null],
      colTotals: [null],
      grandTotal: 5,
    });
    expect(violations.some((v) => v.includes("grand total is shown although it is below k=11"))).toBe(true);
    expect(violations.every((v) => !v.includes("5"))).toBe(true);
  });

  it("flags a threshold that would protect nothing", () => {
    const violations = findSuppressionViolations({
      ...base,
      suppressionThreshold: 1,
      rowLabels: ["spyware"],
      colLabels: ["A"],
      cells: [[3]],
      rowTotals: [3],
      colTotals: [3],
      grandTotal: 3,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/not an integer >= 2/);
  });
});

describe("combinations of lines — values no single line gives away", () => {
  // A real case the per-line rule missed (synthetic seed 23, 316 records): every row and column had
  // at least two hidden values, each line's hidden values summed to at least k, and yet the
  // impersonation row's two hidden cells were the only link between two separate groups of hidden
  // cells. Combining the Q1 and Q4 columns with the spyware and tracker rows recovers
  // impersonation/Q1 = 10 exactly, and then the impersonation row gives impersonation/Q2 = 7.
  const quarterLabels = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];
  const truth = [
    [13, 16, 15, 11],
    [16, 14, 12, 14],
    [11, 18, 13, 12],
    [15, 12, 12, 13],
    [10, 7, 16, 14],
    [15, 14, 5, 18],
  ];
  const oldOutput = {
    rowDimension: "abuse_type",
    colDimension: "quarter",
    rowLabels: [...ABUSE_TYPES],
    colLabels: quarterLabels,
    cells: [
      [null, 16, 15, null],
      [16, null, null, 14],
      [null, 18, 13, null],
      [15, 12, 12, 13],
      [null, null, 16, 14],
      [15, null, null, 18],
    ],
    rowTotals: [55, 56, 54, 52, 47, 52],
    colTotals: [80, 81, 73, 82],
    grandTotal: 316,
    suppressionThreshold: 11,
  };

  it("flags the published table the per-line rule let through, without quoting the recovered values", () => {
    const violations = findSuppressionViolations(oldOutput);
    expect(violations.some((v) => v.includes("combined") && v.includes("recoverable"))).toBe(true);
    expect(violations.join(" ")).not.toMatch(/\b(7|10)\b/);
    // An independent method agrees: exact linear algebra over the same equations.
    expect(linkedTableViolations([{ name: "the table", table: oldOutput }]).join(" ")).toContain("impersonation, 2025-Q2");
  });

  it("suppresses that table so no hidden value is recoverable by any combination of lines", () => {
    const table = suppressTable(
      { rowDimension: "abuse_type", colDimension: "quarter", rowLabels: [...ABUSE_TYPES], colLabels: quarterLabels, matrix: truth },
      11,
    );
    expect(findSuppressionViolations(table)).toEqual([]);
    expect(linkedTableViolations([{ name: "the table", table }])).toEqual([]);
  });

  it("flags hidden values whose exact sum equals their number, which pins each to 1 (small k)", () => {
    // Three hidden 1s next to a shown row total of 3: with k=3 the sum clears k, but three values of
    // at least 1 adding up to 3 must all be exactly 1.
    const pinned = {
      rowDimension: "r",
      colDimension: "c",
      rowLabels: ["a", "b", "c"],
      colLabels: ["x", "y", "z"],
      cells: [
        [null, null, null],
        [5, 5, 5],
        [5, 5, 5],
      ],
      rowTotals: [3, 15, 15],
      colTotals: [null, null, null],
      grandTotal: 33,
      suppressionThreshold: 3,
    };
    expect(findSuppressionViolations(pinned).some((v) => v.includes("pinning each to exactly 1"))).toBe(true);
    const table = suppressTable({ rowDimension: "r", colDimension: "c", rowLabels: ["a", "b", "c"], colLabels: ["x", "y", "z"], matrix: [[1, 1, 1], [5, 5, 5], [5, 5, 5]] }, 3);
    expect(findSuppressionViolations(table)).toEqual([]);
  });

  it("refuses a table too large to check every combination, rather than checking less", () => {
    // 11 x 11 cells, all small, so every line is linked: 24 lines in one group.
    const matrix = Array.from({ length: 11 }, () => Array.from({ length: 11 }, () => 1));
    const labels = matrix.map((_, i) => `l${i}`);
    expect(() => suppressTable({ rowDimension: "r", colDimension: "c", rowLabels: labels, colLabels: labels, matrix }, 11)).toThrow(/too many to check/);
  });

  it("agrees with exact linear algebra across many random sparse tables and thresholds", () => {
    // Two independent methods: suppression works from combinations of lines; the check below solves
    // the table's equations exactly. No hidden value may be pinned down by either.
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    for (let run = 0; run < 300; run++) {
      const k = [2, 3, 5, 11][run % 4]!;
      const rows = 2 + (run % 5);
      const cols = 2 + ((run >> 2) % 5);
      const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (next() < 0.2 ? 0 : Math.floor(next() * 3 * k))));
      const table = suppressTable(
        { rowDimension: "r", colDimension: "c", rowLabels: matrix.map((_, i) => `r${i}`), colLabels: matrix[0]!.map((_, j) => `c${j}`), matrix },
        k,
      );
      expect(findSuppressionViolations(table), `run ${run}`).toEqual([]);
      expect(linkedTableViolations([{ name: "the table", table }]), `run ${run}`).toEqual([]);
    }
  });
});

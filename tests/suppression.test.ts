import { describe, expect, it } from "vitest";
import { ABUSE_TYPES, REGIONS, type IntakeRecord } from "../schema/index.js";
import { buildCrossTab, type Dimension } from "../pipeline/aggregate.js";
import { suppressTable } from "../pipeline/suppress.js";
import { findSuppressionViolations } from "../pipeline/audit.js";
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
});

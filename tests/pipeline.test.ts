import { describe, expect, it } from "vitest";
import { ABUSE_TYPES, FINDING_DETAILS, PLATFORMS, OUTCOMES, REGIONS, type IntakeRecord } from "../schema/index.js";
import { generateIntakeRecords } from "../generator/index.js";
import { countOutcomeFlags } from "../pipeline/outcomes.js";
import { computeDaysToSafetyPlanStats } from "../pipeline/stats.js";
import { runPipeline, findSuppressionViolations, type SuppressedTable } from "../pipeline/index.js";

const quarters = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];

function recordsWith(count: number, overrides: Partial<IntakeRecord> = {}): IntakeRecord[] {
  const hasDays = overrides.days_to_safety_plan !== undefined && overrides.days_to_safety_plan !== null;
  return Array.from(
    { length: count },
    (): IntakeRecord => ({
      abuse_type: "spyware",
      finding_detail: "unknown_or_undetermined",
      platform: "android",
      region: "Region A",
      quarter: "2025-Q1",
      outcome: hasDays ? ["safety_plan"] : [],
      days_to_safety_plan: null,
      ...overrides,
    }),
  );
}

describe("countOutcomeFlags", () => {
  it("suppresses a flag present on fewer than k records, shows a true zero as 0", () => {
    const records = generateIntakeRecords({
      seed: 1,
      quarters,
      totalRecords: 3,
      outcomeRates: { protective_order_filed: 1, safety_plan: 0, evidence_preserved: 0 },
    });
    const counts = countOutcomeFlags(records, 11);
    const filed = counts.find((c) => c.label === "protective_order_filed")!;
    const safetyPlan = counts.find((c) => c.label === "safety_plan")!;
    expect(filed.count).toBeNull(); // 3 records, below k=11
    expect(safetyPlan.count).toBe(0); // never occurs: genuine zero, not suppressed
  });

  it("shows a count that clears k", () => {
    const records = generateIntakeRecords({
      seed: 2,
      quarters,
      totalRecords: 50,
      outcomeRates: { safety_plan: 1, evidence_preserved: 0, protective_order_filed: 0 },
    });
    const counts = countOutcomeFlags(records, 11);
    const safetyPlan = counts.find((c) => c.label === "safety_plan")!;
    expect(safetyPlan.count).toBe(50);
  });

  it("suppresses a count when the shown total minus it is a small non-zero count", () => {
    const records = [...recordsWith(45, { outcome: ["safety_plan"] }), ...recordsWith(5)];
    const withTotal = countOutcomeFlags(records, 11, 50).find((c) => c.label === "safety_plan")!;
    expect(withTotal.count).toBeNull(); // 50 - 45 = 5 records without a safety plan would be derivable
    const withoutTotal = countOutcomeFlags(records, 11).find((c) => c.label === "safety_plan")!;
    expect(withoutTotal.count).toBe(45);
  });
});

describe("computeDaysToSafetyPlanStats", () => {
  const dimension = { name: "quarter", labels: quarters, keyOf: (r: { quarter: string }) => r.quarter };

  it("suppresses a quarter with fewer than k measured records", () => {
    const records = generateIntakeRecords({
      seed: 3,
      quarters: ["2025-Q1"],
      totalRecords: 5,
      outcomeRates: { safety_plan: 1, evidence_preserved: 0, protective_order_filed: 0 },
      daysToSafetyPlan: { meanDays: 5, missingRate: 0 },
    });
    const stats = computeDaysToSafetyPlanStats(records, dimension, 11);
    const q1 = stats.find((s) => s.label === "2025-Q1")!;
    expect(q1.n).toBeNull();
    expect(q1.medianDays).toBeNull();
  });

  it("shows n=0 (not suppressed) for a quarter with no measured records", () => {
    const stats = computeDaysToSafetyPlanStats([], dimension, 11);
    for (const stat of stats) {
      expect(stat.n).toBe(0);
      expect(stat.medianDays).toBeNull();
    }
  });

  it("reveals the median once a quarter clears k", () => {
    const records = generateIntakeRecords({
      seed: 4,
      quarters: ["2025-Q1"],
      totalRecords: 60,
      outcomeRates: { safety_plan: 1, evidence_preserved: 0, protective_order_filed: 0 },
      daysToSafetyPlan: { meanDays: 5, missingRate: 0 },
    });
    const stats = computeDaysToSafetyPlanStats(records, dimension, 11);
    const q1 = stats.find((s) => s.label === "2025-Q1")!;
    expect(q1.n).not.toBeNull();
    expect(q1.n).toBeGreaterThanOrEqual(11);
    expect(q1.medianDays).not.toBeNull();
  });

  it("publishes a median that one extreme record cannot dominate", () => {
    const records = [...recordsWith(10, { days_to_safety_plan: 3 }), ...recordsWith(1, { days_to_safety_plan: 365 })];
    const q1 = computeDaysToSafetyPlanStats(records, dimension, 11).find((s) => s.label === "2025-Q1")!;
    expect(q1.n).toBe(11);
    expect(q1.medianDays).toBe(3);
  });

  it("suppresses the stat when the quarter's shown total minus n is a small non-zero count", () => {
    const records = recordsWith(15, { days_to_safety_plan: 3 });
    const shownTotals = [20, null, null, null]; // 20 records shown for 2025-Q1, 15 measured -> 5 derivable
    const q1 = computeDaysToSafetyPlanStats(records, dimension, 11, shownTotals).find((s) => s.label === "2025-Q1")!;
    expect(q1.n).toBeNull();
    expect(q1.medianDays).toBeNull();
    const unconstrained = computeDaysToSafetyPlanStats(records, dimension, 11).find((s) => s.label === "2025-Q1")!;
    expect(unconstrained.n).toBe(15);
  });
});

describe("runPipeline — rendering-layer boundary", () => {
  it("labels every output as synthetic with a day-level (not real-time) as-of date", () => {
    const records = generateIntakeRecords({ seed: 5, quarters, totalRecords: 400 });
    const output = runPipeline(records, quarters);
    expect(output.synthetic).toBe(true);
    expect(output.dataAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/); // day granularity only, no time component
  });

  it("passes the suppression audit on every table it emits", () => {
    const records = generateIntakeRecords({ seed: 6, quarters, totalRecords: 400 });
    const output = runPipeline(records, quarters);
    expect(findSuppressionViolations(output.data.abuseTypeByQuarter)).toEqual([]);
    expect(findSuppressionViolations(output.data.abuseTypeByRegion)).toEqual([]);
  });

  it("exposes only the documented aggregate shape — no extra keys (must stay in sync with dashboard/types.ts)", () => {
    const records = generateIntakeRecords({ seed: 7, quarters, totalRecords: 400 });
    const output = runPipeline(records, quarters);
    expect(Object.keys(output.data).sort()).toEqual(
      [
        "abuseTypeByQuarter",
        "abuseTypeByRegion",
        "abuseTypeTotals",
        "daysToSafetyPlanByQuarter",
        "outcomeCounts",
        "suppressionThreshold",
      ].sort(),
    );
  });

  it("never carries a record-level-only field (finding_detail, platform) into the aggregate output", () => {
    const records = generateIntakeRecords({ seed: 8, quarters, totalRecords: 400 });
    const output = runPipeline(records, quarters);
    const serialized = JSON.stringify(output);
    for (const value of [...FINDING_DETAILS, ...PLATFORMS]) {
      expect(serialized.includes(value), `record-level field value "${value}" leaked into pipeline output`).toBe(false);
    }
    // outcome/abuse_type/region/quarter category labels ARE expected to
    // appear — they're the aggregate dimensions, not per-record detail.
    expect(serialized).toContain(OUTCOMES[0]);
  });
});

/** Every abuse type well populated in every region, except image_based: 5 records statewide. */
function rareAbuseTypeRecords(): IntakeRecord[] {
  const records: IntakeRecord[] = [];
  ABUSE_TYPES.forEach((abuse_type, a) => {
    REGIONS.forEach((region, r) => {
      if (abuse_type !== "image_based") {
        records.push(...recordsWith(40 + ((a * 11 + r * 5) % 30), { abuse_type, region }));
      } else if (region === "Region A") {
        records.push(...recordsWith(5, { abuse_type, region }));
      }
    });
  });
  return records;
}

function derivableHiddenMass(parts: readonly (number | null)[], total: number | null): number | null {
  if (total === null || parts.every((v) => v !== null)) return null;
  return total - parts.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

describe("runPipeline — cross-table and margin protection", () => {
  it("hides a small statewide total so it can't be recovered from the grand total", () => {
    const { abuseTypeByRegion: t } = runPipeline(rareAbuseTypeRecords(), ["2025-Q1"]).data;
    expect(t.rowTotals[t.rowLabels.indexOf("image_based")]).toBeNull();
    expect(t.rowTotals.filter((v) => v === null).length).toBeGreaterThanOrEqual(2);
    const mass = derivableHiddenMass(t.rowTotals, t.grandTotal);
    if (mass !== null) expect(mass).toBeGreaterThanOrEqual(11);
  });

  it("hides shared totals identically in every table that shows them", () => {
    const { abuseTypeByQuarter: q, abuseTypeByRegion: r, abuseTypeTotals: t } = runPipeline(rareAbuseTypeRecords(), [
      "2025-Q1",
    ]).data;
    expect(q.rowTotals).toEqual(r.rowTotals);
    expect(t.cells.map((row) => row[0])).toEqual(r.rowTotals);
    expect(q.grandTotal).toBe(r.grandTotal);
    expect(t.grandTotal).toBe(r.grandTotal);
  });

  it("suppresses the safety_plan count when 'safety plans with no recorded days' would be a small derivable count", () => {
    const records = [
      ...recordsWith(30, { days_to_safety_plan: 4 }),
      ...recordsWith(5, { outcome: ["safety_plan"] }), // safety plan, no day count recorded
      ...recordsWith(20),
    ];
    const { data } = runPipeline(records, ["2025-Q1"]);
    expect(data.daysToSafetyPlanByQuarter[0]!.n).toBe(30);
    expect(data.outcomeCounts.find((c) => c.label === "safety_plan")!.count).toBeNull(); // 35 - 30 = 5
  });

  it("keeps shared totals consistent and every derivable count 0 or >= k across sparse random datasets", () => {
    const tables = (d: { abuseTypeByQuarter: SuppressedTable; abuseTypeByRegion: SuppressedTable; abuseTypeTotals: SuppressedTable }) => [
      d.abuseTypeByQuarter,
      d.abuseTypeByRegion,
      d.abuseTypeTotals,
    ];
    for (let seed = 1; seed <= 25; seed++) {
      for (const k of [5, 11]) {
        const context = `seed=${seed} k=${k}`;
        const { data } = runPipeline(generateIntakeRecords({ seed, quarters, totalRecords: 20 + seed * 6 }), quarters, k);
        for (const table of tables(data)) expect(findSuppressionViolations(table), context).toEqual([]);
        expect(data.abuseTypeByQuarter.rowTotals, context).toEqual(data.abuseTypeByRegion.rowTotals);
        expect(data.abuseTypeByQuarter.grandTotal, context).toBe(data.abuseTypeByRegion.grandTotal);

        const grand = data.abuseTypeByRegion.grandTotal;
        for (const { label, count } of data.outcomeCounts) {
          if (count === null || grand === null) continue;
          const complement = grand - count;
          expect(complement === 0 || complement >= k, `${context} outcome ${label} complement ${complement}`).toBe(true);
        }
        data.daysToSafetyPlanByQuarter.forEach((stat, i) => {
          const total = data.abuseTypeByQuarter.colTotals[i];
          if (stat.n === null || total === null || total === undefined) return;
          const complement = total - stat.n;
          expect(complement === 0 || complement >= k, `${context} ${stat.label} complement ${complement}`).toBe(true);
        });
        const planned = data.outcomeCounts.find((c) => c.label === "safety_plan")!.count;
        const sizes = data.daysToSafetyPlanByQuarter.map((s) => s.n);
        if (planned !== null && sizes.every((n) => n !== null)) {
          const unmeasured = planned - sizes.reduce<number>((sum, n) => sum + (n ?? 0), 0);
          expect(unmeasured === 0 || unmeasured >= k, `${context} unmeasured safety plans ${unmeasured}`).toBe(true);
        }
      }
    }
  });
});

describe("runPipeline — input boundary", () => {
  function errorMessage(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "";
  }

  it("rejects a record that fails the schema without echoing its content", () => {
    const withNotes = { ...recordsWith(1)[0]!, notes: "lives near the water tower" };
    const withFreeText = { ...recordsWith(1)[0]!, finding_detail: "call from 601-555-0100" };
    for (const [record, secret] of [
      [withNotes, "water tower"],
      [withFreeText, "601-555"],
    ] as const) {
      const message = errorMessage(() => runPipeline([record], ["2025-Q1"]));
      expect(message).toMatch(/record 0 failed schema validation/);
      expect(message).not.toContain(secret);
    }
  });

  it("rejects a record whose quarter is outside the requested quarters", () => {
    expect(() => runPipeline(recordsWith(20, { quarter: "2024-Q4" }), ["2025-Q1"])).toThrow(/outside the requested quarters/);
  });

  it("rejects requested quarters that are empty, malformed or repeated", () => {
    expect(() => runPipeline([], [])).toThrow(/no quarters requested/);
    expect(() => runPipeline([], ["2025-Q5"])).toThrow(/not a YYYY-Qn label/);
    // A repeated label would publish an all-zero column next to a copy of the first one's statistics.
    expect(() => runPipeline(recordsWith(20), ["2025-Q1", "2025-Q1"])).toThrow(/repeat a label/);
  });

  it("refuses a threshold that would disable suppression", () => {
    for (const k of [0, 1, 2.5, Number.NaN]) {
      expect(() => runPipeline(recordsWith(20), ["2025-Q1"], k), `k=${k}`).toThrow(/threshold/);
    }
  });
});

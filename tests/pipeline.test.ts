import { describe, expect, it } from "vitest";
import { FINDING_DETAILS, PLATFORMS, OUTCOMES } from "../schema/index.js";
import { generateIntakeRecords } from "../generator/index.js";
import { countOutcomeFlags } from "../pipeline/outcomes.js";
import { computeDaysToSafetyPlanStats } from "../pipeline/stats.js";
import { runPipeline, findSuppressionViolations } from "../pipeline/index.js";

const quarters = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];

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
    expect(q1.meanDays).toBeNull();
  });

  it("shows n=0 (not suppressed) for a quarter with no measured records", () => {
    const stats = computeDaysToSafetyPlanStats([], dimension, 11);
    for (const stat of stats) {
      expect(stat.n).toBe(0);
      expect(stat.meanDays).toBeNull();
    }
  });

  it("reveals the mean once a quarter clears k", () => {
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
    expect(q1.meanDays).not.toBeNull();
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

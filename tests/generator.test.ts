import { describe, expect, it } from "vitest";
import { isIntakeRecord } from "../schema/index.js";
import { generateIntakeRecords, type GenerateConfig } from "../generator/index.js";
import { backCalculableTotalFixture, justUnderKFixture, sparseRegionFixture } from "../generator/fixtures.js";

const baseConfig: GenerateConfig = {
  seed: 42,
  quarters: ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"],
  totalRecords: 500,
};

describe("generateIntakeRecords", () => {
  it("is deterministic for a given seed", () => {
    const a = generateIntakeRecords(baseConfig);
    const b = generateIntakeRecords({ ...baseConfig });
    expect(a).toEqual(b);
  });

  it("produces a different sequence for a different seed", () => {
    const a = generateIntakeRecords(baseConfig);
    const b = generateIntakeRecords({ ...baseConfig, seed: 43 });
    expect(a).not.toEqual(b);
  });

  it("produces the configured number of records, all schema-valid", () => {
    const records = generateIntakeRecords(baseConfig);
    expect(records).toHaveLength(baseConfig.totalRecords);
    for (const record of records) {
      expect(isIntakeRecord(record)).toBe(true);
    }
  });

  it("applies an abuse_type trend so weight shifts across quarters", () => {
    const quarters = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];
    const records = generateIntakeRecords({
      seed: 7,
      quarters,
      totalRecords: 4000,
      abuseTypeTrends: [{ abuse_type: "spyware", startWeight: 0.1, endWeight: 10 }],
    });

    const share = (quarter: string) => {
      const inQuarter = records.filter((r) => r.quarter === quarter);
      return inQuarter.filter((r) => r.abuse_type === "spyware").length / inQuarter.length;
    };

    expect(share("2025-Q4")).toBeGreaterThan(share("2025-Q1"));
  });
});

describe("generator fixtures", () => {
  it("sparseRegionFixture contains a genuine zero cell alongside populated cells", () => {
    const records = sparseRegionFixture();
    const regionBTrackers = records.filter((r) => r.region === "Region B" && r.abuse_type === "tracker");
    const regionASpyware = records.filter((r) => r.region === "Region A" && r.abuse_type === "spyware");
    expect(regionBTrackers).toHaveLength(0);
    expect(regionASpyware.length).toBeGreaterThan(10);
    for (const record of records) {
      expect(isIntakeRecord(record)).toBe(true);
    }
  });

  it("justUnderKFixture places exactly one cell one record short of k", () => {
    const k = 11;
    const records = justUnderKFixture(k);
    const cell = records.filter((r) => r.abuse_type === "spyware" && r.region === "Region A");
    expect(cell).toHaveLength(k - 1);
  });

  it("backCalculableTotalFixture yields visible totals with exactly one sub-k cell", () => {
    const k = 11;
    const records = backCalculableTotalFixture(k);
    const cell = records.filter((r) => r.abuse_type === "spyware" && r.region === "Region A");
    expect(cell.length).toBeLessThan(k);
    expect(cell.length).toBeGreaterThan(0);
    expect(records.length).toBeGreaterThanOrEqual(k);
  });
});

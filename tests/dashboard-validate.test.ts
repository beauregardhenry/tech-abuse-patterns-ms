import { describe, expect, it } from "vitest";
import { generateIntakeRecords } from "../generator/index.js";
import { runPipeline } from "../pipeline/index.js";
import { validatePayload } from "../dashboard/validate.js";

const quarters = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];

function payload(totalRecords = 400) {
  return structuredClone(runPipeline(generateIntakeRecords({ seed: 11, quarters, totalRecords }), quarters));
}

describe("validatePayload — the dashboard's pre-render guard", () => {
  it("accepts real pipeline output unchanged", () => {
    const p = payload();
    expect(validatePayload(p)).toEqual(p);
  });

  it("accepts sparse pipeline output with suppressed values", () => {
    const p = payload(25);
    expect(JSON.stringify(p)).toContain("null");
    expect(validatePayload(p)).toEqual(p);
  });

  it("rejects a shown count below k in any table cell, total, outcome count, or sample size", () => {
    const tampers: Array<(p: ReturnType<typeof payload>) => void> = [
      (p) => {
        p.data.abuseTypeByRegion.cells[0]![0] = 3;
      },
      (p) => {
        p.data.abuseTypeByQuarter.colTotals[1] = 7;
      },
      (p) => {
        p.data.abuseTypeTotals.grandTotal = 10;
      },
      (p) => {
        p.data.outcomeCounts[0]!.count = 4;
      },
      (p) => {
        p.data.daysToSafetyPlanByQuarter[0]!.n = 2;
      },
    ];
    for (const tamper of tampers) {
      const p = payload();
      tamper(p);
      expect(() => validatePayload(p)).toThrow(/below k=11/);
    }
  });

  it("rejects a lowered or inconsistent threshold", () => {
    const lowered = payload();
    lowered.data.suppressionThreshold = 1;
    expect(() => validatePayload(lowered)).toThrow(/suppressionThreshold/);

    const mismatched = payload();
    mismatched.data.abuseTypeByQuarter.suppressionThreshold = 3;
    expect(() => validatePayload(mismatched)).toThrow(/different threshold/);
  });

  it("rejects unlabelled data or a near-real-time timestamp", () => {
    expect(() => validatePayload(Object.assign(payload(), { synthetic: false }))).toThrow(/synthetic/);
    expect(() => validatePayload(Object.assign(payload(), { dataAsOf: "2026-09-26T14:03:00Z" }))).toThrow(/dataAsOf/);
  });

  it("rejects a malformed table", () => {
    const p = payload();
    p.data.abuseTypeByRegion.cells[0]!.pop();
    expect(() => validatePayload(p)).toThrow(/entries/);
  });

  it("rejects a median published without a publishable sample size", () => {
    const p = payload();
    p.data.daysToSafetyPlanByQuarter[0]!.n = null;
    p.data.daysToSafetyPlanByQuarter[0]!.medianDays = 4;
    expect(() => validatePayload(p)).toThrow(/median/);
  });

  it("drops unknown fields so nothing unexpected reaches the renderer", () => {
    const p = payload();
    Object.assign(p.data, { records: [{ abuse_type: "spyware", notes: "free text" }] });
    Object.assign(p.data.abuseTypeByRegion, { rawMatrix: [[3]] });
    const validated = validatePayload(p);
    expect(Object.keys(validated.data)).not.toContain("records");
    expect(Object.keys(validated.data.abuseTypeByRegion)).not.toContain("rawMatrix");
  });
});

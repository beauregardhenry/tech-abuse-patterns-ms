import { describe, expect, it } from "vitest";
import { isIntakeRecord, parseIntakeRecord } from "../schema/index.js";

function validRecord() {
  return {
    abuse_type: "spyware",
    finding_detail: "stalkerware_app_generic",
    platform: "android",
    region: "Region A",
    quarter: "2025-Q1",
    outcome: ["safety_plan"],
    days_to_safety_plan: 3,
  };
}

describe("IntakeRecordSchema", () => {
  it("accepts a well-formed record", () => {
    expect(() => parseIntakeRecord(validRecord())).not.toThrow();
    expect(isIntakeRecord(validRecord())).toBe(true);
  });

  it("accepts a null days_to_safety_plan", () => {
    const record = { ...validRecord(), days_to_safety_plan: null };
    expect(isIntakeRecord(record)).toBe(true);
  });

  it("rejects any unknown/free-text field, e.g. a survivor name", () => {
    const record = { ...validRecord(), name: "Jane Doe" };
    expect(isIntakeRecord(record)).toBe(false);
    expect(() => parseIntakeRecord(record)).toThrow();
  });

  it("rejects an excluded field: exact age", () => {
    const record = { ...validRecord(), age: 34 };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects an excluded field: exact location / notes free text", () => {
    const record = { ...validRecord(), notes: "lives near the water tower on Elm St" };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects county-level location dressed up as region", () => {
    const record = { ...validRecord(), region: "Hinds County" };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects an exact date in place of quarter", () => {
    const record = { ...validRecord(), quarter: "2025-03-14" };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects an abuse_type outside the fixed enum", () => {
    const record = { ...validRecord(), abuse_type: "harassment_call" };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects a finding_detail that is not on the fixed list (no free text)", () => {
    const record = { ...validRecord(), finding_detail: "some new spyware nobody catalogued yet" };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects a negative days_to_safety_plan", () => {
    const record = { ...validRecord(), days_to_safety_plan: -1 };
    expect(isIntakeRecord(record)).toBe(false);
  });

  it("rejects arbitrary free text substituted into any enum-constrained field", () => {
    // Behavioral guard (not an internals check): every enum field must
    // reject an out-of-vocabulary string, so a future edit can't silently
    // widen a field into a free-text hole.
    const freeText = "unstructured note that could contain identifying detail";
    for (const field of ["abuse_type", "finding_detail", "platform", "region"] as const) {
      const record = { ...validRecord(), [field]: freeText };
      expect(isIntakeRecord(record), `field "${field}" must reject free text`).toBe(false);
    }
  });
});

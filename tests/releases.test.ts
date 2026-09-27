import { describe, expect, it } from "vitest";
import type { IntakeRecord } from "../schema/index.js";
import { generateIntakeRecords } from "../generator/index.js";
import { determinedVariables, runPipeline } from "../pipeline/index.js";
import { exposure, RowSpace, type Release } from "../scripts/releases.js";
import { syntheticDatasetConfig } from "../scripts/synthetic-dataset.js";

const K = 11;

function records(count: number, overrides: Partial<IntakeRecord>): IntakeRecord[] {
  return Array.from({ length: count }, () => ({
    abuse_type: "spyware",
    finding_detail: "unknown_or_undetermined",
    platform: "android",
    region: "Region A",
    quarter: "2025-Q1",
    outcome: [],
    days_to_safety_plan: null,
    ...overrides,
  }));
}

function release(all: readonly IntakeRecord[], quarters: string[]): Release {
  return { quarters, data: runPipeline(all.filter((r) => quarters.includes(r.quarter)), quarters, K).data };
}

describe("RowSpace", () => {
  // A seeded linear congruential generator, so failures reproduce.
  function rng(seed: number) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  }

  it("fixes exactly the variables the exact rational elimination fixes, at their true values", () => {
    const random = rng(7);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(random() * 8);
      const truth = Array.from({ length: n }, () => Math.floor(random() * 30));
      const equations = Array.from({ length: 1 + Math.floor(random() * n) }, () => {
        const eq = new Map<number, number>();
        for (let v = 0; v < n; v++) if (random() < 0.4) eq.set(v, 1);
        return eq;
      }).filter((eq) => eq.size > 0);
      const space = new RowSpace(n);
      for (const eq of equations) space.add(eq, [...eq.keys()].reduce((s, v) => s + truth[v]!, 0));
      const exact = new Set(determinedVariables(equations, n));
      for (let v = 0; v < n; v++) {
        const derived = space.derive(new Map([[v, 1]]));
        expect(derived !== null).toBe(exact.has(v));
        if (derived !== null) expect(Math.abs(derived - truth[v]!)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("comparing releases", () => {
  it("finds a new quarter's count by subtracting the previous cumulative release", () => {
    // Release 1 (Q1) shows 20 spyware records in Region A. Release 2 (Q1 and Q2) shows 23 there, so
    // Q2 added 3, a count below k that no release shows.
    const all = [
      ...records(20, { quarter: "2025-Q1" }),
      ...records(3, { quarter: "2025-Q2" }),
      ...records(20, { quarter: "2025-Q2", region: "Region B" }),
    ];
    const first = release(all, ["2025-Q1"]);
    const second = release(all, ["2025-Q1", "2025-Q2"]);
    const label = "spyware, Region A, 2025-Q2";

    const alone = exposure([second], all, K).smallUnpublished.find((f) => f.label === label);
    expect(alone?.exposed).toBe(false);
    const together = exposure([first, second], all, K).smallUnpublished.find((f) => f.label === label);
    expect(together).toMatchObject({ exposed: true, derived: 3, value: 3 });
  });

  const generated = (perYear: number, seed: number) =>
    generateIntakeRecords({
      ...syntheticDatasetConfig(perYear * 2),
      seed,
      quarters: ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"],
    });

  it("finds nothing in any single release, the pipeline's own guarantee", () => {
    for (const seed of [1, 2]) {
      const all = generated(250, seed);
      for (const quarters of [["2025-Q1"], ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]]) {
        const e = exposure([release(all, quarters)], all, K);
        expect(e.suppressed.filter((f) => f.exposed)).toEqual([]);
        expect(e.smallUnpublished.filter((f) => f.exposed)).toEqual([]);
      }
    }
  });

  it("finds nothing extra when releases cover separate years", () => {
    const all = generated(250, 3);
    const years = [release(all, ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]), release(all, ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"])];
    const e = exposure(years, all, K);
    expect(e.suppressed.filter((f) => f.exposed)).toEqual([]);
    expect(e.smallUnpublished.filter((f) => f.exposed)).toEqual([]);
  });

  it("recovers suppressed values when overlapping releases hide different cells", () => {
    // Synthetic seed 1 at 250 records a year, rolling four-quarter windows: release 2 hides a value
    // release 1 showed, as its complement for a small one. (Found by scripts/analyze-releases.ts.)
    const all = generated(250, 1);
    const windows = [0, 1, 2, 3, 4].map((start) => ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"].slice(start, start + 4));
    const e = exposure(
      windows.map((w) => release(all, w)),
      all,
      K,
    );
    const recovered = e.suppressed.filter((f) => f.exposed && f.value < K);
    expect(recovered.length).toBeGreaterThan(0);
    for (const f of recovered) expect(f.derived).toBe(f.value);
  });

  it("refuses to run when its model of a release doesn't match what the release shows", () => {
    const all = records(20, {});
    const r = release(all, ["2025-Q1"]);
    const tampered: Release = {
      ...r,
      data: { ...r.data, abuseTypeByQuarter: { ...r.data.abuseTypeByQuarter, grandTotal: 21 } },
    };
    expect(() => exposure([tampered], all, K)).toThrow(/doesn't match/);
  });
});

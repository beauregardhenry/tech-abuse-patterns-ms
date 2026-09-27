#!/usr/bin/env -S npx tsx
// For the disclosure review: if the dashboard is refreshed every quarter and someone saves every
// release, what can they compute by comparing releases that no single release gives away? Measured
// on synthetic data under four release policies, over two years of quarters (see scripts/releases.ts
// for the method and what it doesn't cover).
//
// The generator's distributions are arbitrary (see docs/PRIVACY.md), so these numbers describe how
// the release policies behave, not how real data would come out.
//
//   npx tsx scripts/analyze-releases.ts [runs per scenario, default 30]

import { generateIntakeRecords } from "../generator/index.js";
import { runPipeline } from "../pipeline/index.js";
import { exposure, type Release } from "./releases.js";
import { syntheticDatasetConfig } from "./synthetic-dataset.js";

const K = 11;
const QUARTERS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"];
const upTo = (end: number, start = 0) => QUARTERS.slice(start, end);

// Each policy is the list of quarter windows its releases cover, in release order.
export const POLICIES: { name: string; windows: string[][] }[] = [
  { name: "Add each new quarter to the last release", windows: [4, 5, 6, 7, 8].map((end) => upTo(end)) },
  { name: "Year to date, refreshed quarterly", windows: [1, 2, 3, 4].map((end) => upTo(end)).concat([5, 6, 7, 8].map((end) => upTo(end, 4))) },
  { name: "Rolling four quarters", windows: [4, 5, 6, 7, 8].map((end) => upTo(end, end - 4)) },
  { name: "One release per calendar year", windows: [upTo(4), upTo(8, 4)] },
];

interface Tally {
  suppressedBelowK: number;
  suppressedAlone: number;
  suppressedTogether: number;
  complementaryUndone: number;
  complementary: number;
  small: number;
  smallAlone: number;
  smallTogether: number;
  byKind: Map<string, { small: number; exposed: number }>;
}

function scenario(windows: string[][], perYear: number, runs: number): Tally {
  const t: Tally = {
    suppressedBelowK: 0,
    suppressedAlone: 0,
    suppressedTogether: 0,
    complementaryUndone: 0,
    complementary: 0,
    small: 0,
    smallAlone: 0,
    smallTogether: 0,
    byKind: new Map(),
  };
  for (let seed = 1; seed <= runs; seed++) {
    const records = generateIntakeRecords({ ...syntheticDatasetConfig(perYear * 2), seed, quarters: QUARTERS });
    const releases: Release[] = windows.map((w) => ({
      quarters: w,
      data: runPipeline(
        records.filter((r) => w.includes(r.quarter)),
        w,
        K,
      ).data,
    }));
    // Labels name the same count the same way in every release, so they match across analyses.
    const aloneExposed = new Set(
      releases.flatMap((r) => {
        const e = exposure([r], records, K);
        return [...e.suppressed, ...e.smallUnpublished].filter((f) => f.exposed).map((f) => f.label);
      }),
    );
    const together = exposure(releases, records, K);
    for (const f of together.suppressed) {
      if (f.value > 0 && f.value < K) {
        t.suppressedBelowK++;
        if (aloneExposed.has(f.label)) t.suppressedAlone++;
        if (f.exposed) t.suppressedTogether++;
      } else {
        t.complementary++;
        if (f.exposed) t.complementaryUndone++;
      }
    }
    // Only quarters that arrive after the first release: the first release's quarters arrive all at
    // once, so there is no earlier release to compare them against.
    for (const f of together.smallUnpublished.filter((f) => !windows[0]!.includes(f.quarter!))) {
      t.small++;
      if (aloneExposed.has(f.label)) t.smallAlone++;
      if (f.exposed) t.smallTogether++;
      const kind = t.byKind.get(f.kind) ?? { small: 0, exposed: 0 };
      kind.small++;
      if (f.exposed) kind.exposed++;
      t.byKind.set(f.kind, kind);
    }
  }
  return t;
}

const pct = (part: number, whole: number) => (whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`);
const share = (part: number, whole: number) => `${part} of ${whole} (${pct(part, whole)})`;

function main() {
  const runs = Number(process.argv[2] ?? 30);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a positive whole number");
  console.log(
    `${runs} synthetic datasets per scenario, 8 quarters (2025-Q1 to 2026-Q4) x 6 regions x 6 abuse types, k = ${K}.\n` +
      "The viewer saves every release and compares them all. \"Small\" means 1 to k-1. \"Never-published counts\" are\n" +
      "single-quarter counts no release shows (abuse type x region, region, outcome), in quarters added after the first release.\n",
  );
  const breakdown: string[] = [];
  console.log(
    "| Release policy | Records per year | Releases | Small suppressed values recovered: each release alone | ... releases compared | Small never-published counts exposed: each release alone | ... releases compared | Complementary suppressions undone |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const { name, windows } of POLICIES) {
    for (const perYear of [250, 1000, 5000]) {
      const t = scenario(windows, perYear, runs);
      console.log(
        `| ${name} | ${perYear} | ${windows.length} | ${share(t.suppressedAlone, t.suppressedBelowK)} | ${share(t.suppressedTogether, t.suppressedBelowK)} | ${share(t.smallAlone, t.small)} | ${share(t.smallTogether, t.small)} | ${share(t.complementaryUndone, t.complementary)} |`,
      );
      for (const [kind, { small, exposed }] of t.byKind) breakdown.push(`| ${name} | ${perYear} | ${kind} | ${share(exposed, small)} |`);
    }
  }
  console.log("\nSmall never-published counts exposed with releases compared, by kind:\n");
  console.log("| Release policy | Records per year | Count | Exposed |\n| --- | --- | --- | --- |");
  for (const line of breakdown) console.log(line);
}

main();

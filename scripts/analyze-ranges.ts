#!/usr/bin/env -S npx tsx
// For the disclosure review: on synthetic data, how much does the pipeline suppress, and how narrowly
// can a viewer still bound each suppressed value using everything published? The rules stop exact
// recovery; this measures the ranges they allow, across dataset sizes and thresholds.
//
// The generator's distributions are arbitrary (see docs/PRIVACY.md), so these numbers describe how
// the rules behave, not how real data would come out.
//
//   npx tsx scripts/analyze-ranges.ts [runs per scenario, default 30]

import { generateIntakeRecords } from "../generator/index.js";
import { runPipeline } from "../pipeline/index.js";
import { hiddenRanges, publishedSystem } from "./ranges.js";

const QUARTERS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];
// The same uneven regions as the dashboard's synthetic dataset, so some regions are sparse.
const REGION_WEIGHTS = { "Region A": 3, "Region B": 2.5, "Region C": 1, "Region D": 0.4, "Region E": 0.2, "Region F": 1.5 };
// Distinct values across the two cross-tabs, shared totals counted once: 24 + 4 + 36 + 6 + 6 + 1.
const PUBLISHED_VALUES = 77;

interface Summary {
  suppressedShare: number;
  hidden: number;
  exact: number;
  knownBelowK: number;
  narrowerThanK: number;
  unbounded: number;
  medianWidth: number;
  narrowestWidth: number;
}

function scenario(totalRecords: number, k: number, runs: number): Summary {
  let hiddenTotal = 0;
  let exact = 0;
  let knownBelowK = 0;
  let narrowerThanK = 0;
  let unbounded = 0;
  const widths: number[] = [];
  for (let seed = 1; seed <= runs; seed++) {
    const records = generateIntakeRecords({ seed, quarters: QUARTERS, totalRecords, regionWeights: REGION_WEIGHTS });
    const { data } = runPipeline(records, QUARTERS, k);
    const ranges = hiddenRanges(
      publishedSystem([
        { name: "by quarter", table: data.abuseTypeByQuarter },
        { name: "by region", table: data.abuseTypeByRegion },
      ]),
    );
    hiddenTotal += ranges.length;
    for (const { min, max } of ranges) {
      if (max === Infinity) {
        unbounded++;
        continue;
      }
      const width = max - min;
      widths.push(width);
      if (width === 0) exact++;
      if (max < k) knownBelowK++;
      if (width < k) narrowerThanK++;
    }
  }
  widths.sort((a, b) => a - b);
  return {
    suppressedShare: hiddenTotal / (PUBLISHED_VALUES * runs),
    hidden: hiddenTotal,
    exact,
    knownBelowK,
    narrowerThanK,
    unbounded,
    medianWidth: widths.length ? widths[Math.floor(widths.length / 2)]! : Number.NaN,
    narrowestWidth: widths.length ? widths[0]! : Number.NaN,
  };
}

const pct = (part: number, whole: number) => (whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`);

function row(label: string, s: Summary): string {
  return `| ${label} | ${pct(s.suppressedShare * 100, 100)} | ${s.hidden} | ${s.exact} | ${pct(s.knownBelowK, s.hidden)} | ${pct(s.narrowerThanK, s.hidden)} | ${Number.isNaN(s.medianWidth) ? "n/a" : s.medianWidth} | ${Number.isNaN(s.narrowestWidth) ? "n/a" : s.narrowestWidth} | ${pct(s.unbounded, s.hidden)} |`;
}

function main() {
  const runs = Number(process.argv[2] ?? 30);
  const header =
    "| Scenario | Values suppressed | Hidden values measured | Recoverable exactly | Known to be below k | Range narrower than k | Median range width | Narrowest range width | No upper bound |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  console.log(`${runs} synthetic datasets per scenario, 4 quarters x 6 regions x 6 abuse types.\n`);
  console.log("By dataset size (records per year), k = 11:\n");
  console.log(header);
  for (const n of [100, 250, 500, 1000, 2000]) console.log(row(`${n} records`, scenario(n, 11, runs)));
  console.log("\nBy threshold, 500 records per year:\n");
  console.log(header);
  for (const k of [5, 11, 20]) console.log(row(`k = ${k}`, scenario(500, k, runs)));
}

main();

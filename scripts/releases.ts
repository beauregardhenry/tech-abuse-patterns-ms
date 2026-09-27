// What a viewer can work out by comparing releases. Each release is safe on its own, but a viewer
// who saved an earlier release can subtract it from a later one. For example, the by-region table
// covers every quarter in a release, so if the next release adds a quarter and keeps the others,
// the difference between the two by-region tables is the new quarter's abuse type x region counts,
// a breakdown that is never published and so never checked against k. This is an analysis tool for
// the disclosure review, not part of the privacy path; which release policy to adopt is a decision.
//
// The unknowns are the counts underneath every release: records per abuse type x region x quarter,
// per outcome x quarter, and records with a days-to-safety-plan value per quarter. Every value a
// release shows is a sum of some of them, which gives one equation each. A viewer can compute a
// count exactly when it is a combination of those equations. Shown zeros also
// fix every unknown under them to zero, since counts can't be negative. Beyond that, the check
// doesn't use the fact that counts are non-negative whole numbers, so it measures exact recovery
// only, not ranges (scripts/ranges.ts does ranges within one release).
//
// The elimination is floating point. The equations' coefficients are all 0 or 1, so this is
// numerically benign, and tests/releases.test.ts checks it against the exact rational version in
// shared/linked.ts.

import { ABUSE_TYPES, OUTCOMES, REGIONS, type IntakeRecord } from "../schema/index.js";
import type { DashboardAggregates } from "../pipeline/index.js";

export interface Release {
  quarters: readonly string[];
  data: DashboardAggregates;
}

/** A sum of unknowns: variable index -> coefficient. */
export type Combination = Map<number, number>;

/** A count a viewer might learn, with its true value (known here because the data is synthetic). */
export interface Quantity {
  kind: string;
  label: string;
  /** The quarter a per-quarter count belongs to. */
  quarter?: string;
  combination: Combination;
  value: number;
}

export interface Finding extends Quantity {
  /** Whether the viewer can compute the value exactly. */
  exposed: boolean;
  /** What the viewer computes from published values alone, when exposed. `exposure` throws unless it equals `value`. */
  derived: number | null;
}

export interface Exposure {
  /** Every distinct value some release suppressed. */
  suppressed: Finding[];
  /** Every per-quarter count from 1 to k-1 that no release shows or suppresses. */
  smallUnpublished: Finding[];
}

const EPS = 1e-9;

/**
 * The equations a viewer can write down, kept reduced so each query is one pass: each stored row
 * has a pivot column set to 1 and zero at the pivots of every row stored before it. A sum of
 * unknowns is known exactly when it is a combination of the rows, and its value is the same
 * combination of the right-hand sides.
 */
export class RowSpace {
  private readonly rows: { pivot: number; row: Float64Array; rhs: number }[] = [];

  constructor(private readonly size: number) {}

  private reduce(combination: Combination, rhs: number): { v: Float64Array; rhs: number } {
    const v = new Float64Array(this.size);
    for (const [i, c] of combination) v[i] = c;
    for (const row of this.rows) {
      const f = v[row.pivot]!;
      if (Math.abs(f) <= EPS) continue;
      for (let j = 0; j < this.size; j++) v[j] = v[j]! - f * row.row[j]!;
      rhs -= f * row.rhs;
    }
    return { v, rhs };
  }

  /** Adds the equation `combination = rhs`. */
  add(combination: Combination, rhs: number): void {
    const { v, rhs: r } = this.reduce(combination, rhs);
    let pivot = -1;
    for (let j = 0; j < this.size; j++) {
      if (Math.abs(v[j]!) > EPS && (pivot === -1 || Math.abs(v[j]!) > Math.abs(v[pivot]!))) pivot = j;
    }
    if (pivot === -1) return;
    const p = v[pivot]!;
    for (let j = 0; j < this.size; j++) v[j] = v[j]! / p;
    this.rows.push({ pivot, row: v, rhs: r / p });
  }

  /** The combination's value if the equations added so far fix it exactly, otherwise null. */
  derive(combination: Combination): number | null {
    const { v, rhs } = this.reduce(combination, 0);
    return v.every((x) => Math.abs(x) <= EPS) ? 0 - rhs : null;
  }
}

/** Indexes the unknowns under a set of releases and computes their true values from the records. */
class Unknowns {
  private readonly index = new Map<string, number>();
  readonly quarters: string[];

  constructor(quarters: readonly string[]) {
    this.quarters = [...new Set(quarters)].sort();
    for (const q of this.quarters) {
      for (const a of ABUSE_TYPES) for (const g of REGIONS) this.key(`x|${a}|${g}|${q}`);
      for (const o of OUTCOMES) this.key(`y|${o}|${q}`);
      this.key(`d|${q}`);
    }
  }

  private key(k: string): void {
    this.index.set(k, this.index.size);
  }

  get size(): number {
    return this.index.size;
  }

  /** A record in abuse type a, region g, quarter q. */
  x(a: string, g: string, q: string): number {
    return this.index.get(`x|${a}|${g}|${q}`)!;
  }

  /** Records in quarter q with outcome o. */
  y(o: string, q: string): number {
    return this.index.get(`y|${o}|${q}`)!;
  }

  /** Records in quarter q with a days-to-safety-plan value. */
  d(q: string): number {
    return this.index.get(`d|${q}`)!;
  }

  truth(records: readonly IntakeRecord[]): Float64Array {
    const t = new Float64Array(this.size);
    for (const r of records) {
      if (!this.quarters.includes(r.quarter)) continue;
      t[this.x(r.abuse_type, r.region, r.quarter)]++;
      for (const o of r.outcome) t[this.y(o, r.quarter)]++;
      if (r.days_to_safety_plan !== null) t[this.d(r.quarter)]++;
    }
    return t;
  }
}

function sum(indices: Iterable<number>): Combination {
  const c: Combination = new Map();
  for (const i of indices) c.set(i, (c.get(i) ?? 0) + 1);
  return c;
}

function valueOf(combination: Combination, truth: Float64Array): number {
  let v = 0;
  for (const [i, c] of combination) v += c * truth[i]!;
  return v;
}

interface PublishedValue {
  label: string;
  combination: Combination;
  shown: number | null;
}

/** Every count a release shows or suppresses, as a sum of unknowns. */
function publishedValues(release: Release, u: Unknowns): PublishedValue[] {
  const { quarters, data } = release;
  const out: PublishedValue[] = [];
  const cells = (a: string, gs: readonly string[], qs: readonly string[]) => sum(gs.flatMap((g) => qs.map((q) => u.x(a, g, q))));
  const all = (gs: readonly string[], qs: readonly string[]) => sum(ABUSE_TYPES.flatMap((a) => gs.flatMap((g) => qs.map((q) => u.x(a, g, q)))));
  // Labels name a count the same way wherever it appears, so one quarter's window is just the quarter.
  const window = quarters.length === 1 ? quarters[0]! : `${quarters[0]} to ${quarters[quarters.length - 1]}`;

  const byQuarter = data.abuseTypeByQuarter;
  ABUSE_TYPES.forEach((a, i) => {
    quarters.forEach((q, j) => out.push({ label: `${a}, ${q}`, combination: cells(a, REGIONS, [q]), shown: byQuarter.cells[i]![j]! }));
    out.push({ label: `${a}, ${window}`, combination: cells(a, REGIONS, quarters), shown: byQuarter.rowTotals[i]! });
  });
  quarters.forEach((q, j) => out.push({ label: `all records, ${q}`, combination: all(REGIONS, [q]), shown: byQuarter.colTotals[j]! }));
  out.push({ label: `all records, ${window}`, combination: all(REGIONS, quarters), shown: byQuarter.grandTotal });

  const byRegion = data.abuseTypeByRegion;
  ABUSE_TYPES.forEach((a, i) => {
    REGIONS.forEach((g, j) => out.push({ label: `${a}, ${g}, ${window}`, combination: cells(a, [g], quarters), shown: byRegion.cells[i]![j]! }));
  });
  REGIONS.forEach((g, j) => out.push({ label: `${g}, ${window}`, combination: all([g], quarters), shown: byRegion.colTotals[j]! }));

  for (const { label, count } of data.outcomeCounts) {
    out.push({ label: `${label}, ${window}`, combination: sum(quarters.map((q) => u.y(label, q))), shown: count });
  }
  for (const { label, n } of data.daysToSafetyPlanByQuarter) {
    out.push({ label: `days recorded, ${label}`, combination: sum([u.d(label)]), shown: n });
  }
  return out;
}

/** Per-quarter counts no release publishes directly: the breakdowns differencing can expose. */
function perQuarterCounts(u: Unknowns, truth: Float64Array): Quantity[] {
  const out: Quantity[] = [];
  for (const q of u.quarters) {
    const add = (kind: string, label: string, combination: Combination) => out.push({ kind, label, quarter: q, combination, value: valueOf(combination, truth) });
    for (const a of ABUSE_TYPES) for (const g of REGIONS) add("abuse type x region x quarter", `${a}, ${g}, ${q}`, sum([u.x(a, g, q)]));
    for (const g of REGIONS) add("region x quarter", `${g}, ${q}`, sum(ABUSE_TYPES.map((a) => u.x(a, g, q))));
    const quarterTotal = sum(ABUSE_TYPES.flatMap((a) => REGIONS.map((g) => u.x(a, g, q))));
    for (const o of OUTCOMES) {
      add("outcome x quarter", `${o}, ${q}`, sum([u.y(o, q)]));
      const without = new Map(quarterTotal);
      without.set(u.y(o, q), -1);
      add("outcome x quarter", `no ${o}, ${q}`, without);
    }
    const unmeasured: Combination = new Map([
      [u.y("safety_plan", q), 1],
      [u.d(q), -1],
    ]);
    add("outcome x quarter", `safety plan with no days recorded, ${q}`, unmeasured);
  }
  return out;
}

/** Drops unknowns a shown zero fixes at zero; they contribute nothing to any sum. */
function withoutZeros(combination: Combination, zero: ReadonlySet<number>): Combination {
  return new Map([...combination].filter(([i]) => !zero.has(i)));
}

const keyOf = (c: Combination) =>
  [...c]
    .sort(([a], [b]) => a - b)
    .map(([i, v]) => `${i}:${v}`)
    .join(",");

/** What a viewer holding every release in `releases` can compute exactly, at threshold k. */
export function exposure(releases: readonly Release[], records: readonly IntakeRecord[], k: number): Exposure {
  const u = new Unknowns(releases.flatMap((r) => r.quarters));
  const truth = u.truth(records);
  const published = releases.flatMap((r) => publishedValues(r, u));
  for (const p of published) {
    if (p.shown !== null && p.shown !== valueOf(p.combination, truth)) {
      throw new Error(`the model of "${p.label}" doesn't match what the release shows`);
    }
  }

  const zero = new Set<number>();
  for (const p of published) if (p.shown === 0) for (const i of p.combination.keys()) zero.add(i);
  const space = new RowSpace(u.size);
  for (const p of published) if (p.shown !== null) space.add(withoutZeros(p.combination, zero), p.shown);
  const shown = new Map(published.filter((p) => p.shown !== null).map((p) => [keyOf(p.combination), p.shown!]));

  // A value suppressed in one release can be shown in another (suppression patterns differ between
  // releases); then the suppression hides nothing from this viewer.
  const find = (q: Quantity): Finding => {
    const d = shown.get(keyOf(q.combination)) ?? space.derive(withoutZeros(q.combination, zero));
    const derived = d === null ? null : Math.round(d) + 0; // + 0 turns -0 into 0
    if (derived !== null && (Math.abs(d! - q.value) > 1e-6 || derived !== q.value)) {
      throw new Error(`"${q.label}" was derived as a different value than the data holds; the analysis is wrong`);
    }
    return { ...q, exposed: derived !== null, derived };
  };

  const hidden = new Map<string, PublishedValue>();
  for (const p of published) if (p.shown === null && !hidden.has(keyOf(p.combination))) hidden.set(keyOf(p.combination), p);
  const suppressed = [...hidden.values()].map((p) =>
    find({ kind: "suppressed value", label: p.label, combination: p.combination, value: valueOf(p.combination, truth) }),
  );
  const smallUnpublished = perQuarterCounts(u, truth)
    .filter((q) => q.value > 0 && q.value < k && !shown.has(keyOf(q.combination)) && !hidden.has(keyOf(q.combination)))
    .map(find);
  return { suppressed, smallUnpublished };
}

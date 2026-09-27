// How narrowly a viewer can pin down each suppressed value, using everything published: every line
// of every table that shares totals, and the fact that hidden values are at least 1 (zeros are
// never hidden). This is an analysis tool for the disclosure review, not part of the privacy path.
// The pipeline's rules stop exact recovery; this measures the ranges those rules still allow.
//
// Each hidden value's range is two small linear programs (minimize it, maximize it) over the same
// equations shared/linked.ts builds, plus the published values as constants. Solved with a dense
// two-phase simplex method using Bland's rule (no cycling). The tables here are small (a few dozen
// equations and hidden values), so nothing faster is needed. Values are whole numbers, so bounds
// are rounded inward. tests/ranges.test.ts checks this against brute-force enumeration.

import type { PublishedTable } from "../shared/disclosure.js";

export interface HiddenRange {
  label: string;
  min: number;
  /** Infinity when nothing published bounds it from above. */
  max: number;
}

interface LinearSystem {
  labels: string[];
  /** Each equation: coefficients by variable index, and the constant on the right-hand side. */
  equations: { coefs: Map<number, number>; rhs: number }[];
}

/** The equations a viewer can write down, over the hidden values of tables that share row and grand totals. */
export function publishedSystem(tables: readonly { name: string; table: PublishedTable }[]): LinearSystem {
  const index = new Map<string, number>();
  const labels: string[] = [];
  const variable = (key: string, label: string) => {
    if (!index.has(key)) {
      index.set(key, index.size);
      labels.push(label);
    }
    return index.get(key)!;
  };
  const equations: LinearSystem["equations"] = [];
  for (const { name, table } of tables) {
    const R = table.rowLabels.length;
    const C = table.colLabels.length;
    const valueAt = (i: number, j: number): { shown: number } | { hidden: number } => {
      if (i < R && j < C) {
        const v = table.cells[i]![j]!;
        return v === null ? { hidden: variable(`${name}[${i},${j}]`, `${name}: ${table.rowLabels[i]} / ${table.colLabels[j]}`) } : { shown: v };
      }
      if (i < R) {
        const v = table.rowTotals[i]!;
        return v === null ? { hidden: variable(`row ${i}`, `total: ${table.rowLabels[i]}`) } : { shown: v };
      }
      if (j < C) {
        const v = table.colTotals[j]!;
        return v === null ? { hidden: variable(`${name}[total,${j}]`, `${name}: total ${table.colLabels[j]}`) } : { shown: v };
      }
      return table.grandTotal === null ? { hidden: variable("grand", "grand total") } : { shown: table.grandTotal };
    };
    const line = (parts: [number, number][], total: [number, number]) => {
      const coefs = new Map<number, number>();
      let rhs = 0;
      const add = ([i, j]: [number, number], c: number) => {
        const v = valueAt(i, j);
        if ("hidden" in v) coefs.set(v.hidden, (coefs.get(v.hidden) ?? 0) + c);
        else rhs -= c * v.shown;
      };
      parts.forEach((p) => add(p, 1));
      add(total, -1);
      if (coefs.size > 0) equations.push({ coefs, rhs });
    };
    for (let i = 0; i <= R; i++) line(Array.from({ length: C }, (_, j) => [i, j] as [number, number]), [i, C]);
    for (let j = 0; j <= C; j++) line(Array.from({ length: R }, (_, i) => [i, j] as [number, number]), [R, j]);
  }
  return { labels, equations };
}

/** The tightest whole-number range for every hidden value, given x >= 1 for each. */
export function hiddenRanges(system: LinearSystem): HiddenRange[] {
  const n = system.labels.length;
  // Substitute y = x - 1 >= 0, so each equation's right-hand side drops by its coefficient sum.
  const A = system.equations.map((eq) => Array.from({ length: n }, (_, v) => eq.coefs.get(v) ?? 0));
  const b = system.equations.map((eq, r) => eq.rhs - A[r]!.reduce((s, c) => s + c, 0));
  return system.labels.map((label, v) => {
    const unit = Array.from({ length: n }, (_, j) => (j === v ? 1 : 0));
    const low = minimize(A, b, unit);
    const high = minimize(A, b, unit.map((c) => -c));
    return {
      label,
      min: 1 + Math.ceil(low.value - 1e-7),
      max: high.unbounded ? Infinity : 1 + Math.floor(-high.value + 1e-7),
    };
  });
}

const EPS = 1e-9;

/** min c.y subject to A y = b, y >= 0. Throws if infeasible (published values always have a solution). */
export function minimize(A: number[][], b: number[], c: number[]): { value: number; unbounded: boolean } {
  const n = c.length;
  const rows = A.map((row, i) => (b[i]! < 0 ? [...row.map((x) => -x), -b[i]!] : [...row, b[i]!]));
  const m = rows.length;
  // Tableau: n original columns, m artificial columns, then the right-hand side.
  let T = rows.map((row, i) => [...row.slice(0, n), ...Array.from({ length: m }, (_, a) => (a === i ? 1 : 0)), row[n]!]);
  let basis = Array.from({ length: m }, (_, i) => n + i);
  const width = n + m;

  const run = (cost: (j: number) => number, allowed: (j: number) => boolean): "optimal" | "unbounded" => {
    for (;;) {
      let entering = -1;
      for (let j = 0; j < width && entering === -1; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let reduced = cost(j);
        for (let i = 0; i < T.length; i++) reduced -= cost(basis[i]!) * T[i]![j]!;
        if (reduced < -EPS) entering = j;
      }
      if (entering === -1) return "optimal";
      let leaving = -1;
      for (let i = 0; i < T.length; i++) {
        const a = T[i]![entering]!;
        if (a <= EPS) continue;
        if (leaving === -1) {
          leaving = i;
          continue;
        }
        const ratio = T[i]![width]! / a;
        const best = T[leaving]![width]! / T[leaving]![entering]!;
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i]! < basis[leaving]!)) leaving = i;
      }
      if (leaving === -1) return "unbounded";
      pivot(leaving, entering);
    }
  };
  const pivot = (r: number, col: number) => {
    const p = T[r]![col]!;
    T[r] = T[r]!.map((x) => x / p);
    for (let i = 0; i < T.length; i++) {
      const f = T[i]![col]!;
      if (i !== r && Math.abs(f) > EPS) T[i] = T[i]!.map((x, j) => x - f * T[r]![j]!);
    }
    basis[r] = col;
  };

  // Phase 1: find a feasible basis by minimizing the sum of the artificial variables.
  run((j) => (j >= n ? 1 : 0), () => true);
  const infeasibility = T.reduce((s, row, i) => s + (basis[i]! >= n ? row[width]! : 0), 0);
  if (infeasibility > 1e-7) throw new Error("the published values have no solution; the tables are inconsistent");
  // Drive any artificial still in the basis (at zero) out; if its row has nothing else, it's redundant.
  for (let i = T.length - 1; i >= 0; i--) {
    if (basis[i]! < n) continue;
    const j = T[i]!.findIndex((x, col) => col < n && Math.abs(x) > EPS);
    if (j !== -1) {
      pivot(i, j);
    } else {
      T = T.filter((_, r) => r !== i);
      basis = basis.filter((_, r) => r !== i);
    }
  }

  // Phase 2: the real objective, artificial columns barred from re-entering.
  const status = run((j) => (j < n ? c[j]! : 0), (j) => j < n);
  if (status === "unbounded") return { value: -Infinity, unbounded: true };
  const value = T.reduce((s, row, i) => s + (basis[i]! < n ? c[basis[i]!]! * row[width]! : 0), 0);
  return { value, unbounded: false };
}

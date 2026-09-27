// Tables that share totals. The by-quarter and by-region cross-tabs share their per-row totals and
// their grand total, so a viewer can combine the two tables' equations. shared/disclosure.ts makes
// each table safe on its own; this checks what only the combination could give away.
//
// Two checks, both on published values only:
//   - the shared totals must be identical in every table, shown or hidden alike, or a total hidden
//     in one could be read straight off another;
//   - no hidden value may be exactly recoverable from all the tables' equations together. This is
//     exact linear algebra over the rationals (no rounding), on the equations' coefficients only.
//
// Unlike the per-table rules, there is no automatic fix for the second check: it has never fired in
// randomized testing (every table is already safe on its own), so the pipeline fails closed instead.
//
// Nothing in shared/ may import schema/, generator/ or pipeline/ (see shared/disclosure.ts).

import type { PublishedTable } from "./disclosure.js";

/** Every way `tables`, which must share row labels, row totals and grand total, fail to be safe together. */
export function linkedTableViolations(tables: readonly { name: string; table: PublishedTable }[]): string[] {
  const violations: string[] = [];
  const [first, ...rest] = tables;
  if (!first) return violations;
  for (const { name, table } of rest) {
    const sameRows =
      table.rowLabels.length === first.table.rowLabels.length && table.rowLabels.every((label, i) => label === first.table.rowLabels[i]);
    if (!sameRows) {
      violations.push(`${name} does not have the same rows as ${first.name}`);
      continue;
    }
    table.rowTotals.forEach((v, i) => {
      if (v !== first.table.rowTotals[i]) violations.push(`row total "${table.rowLabels[i]}" differs between ${first.name} and ${name}`);
    });
    if (table.grandTotal !== first.table.grandTotal) violations.push(`the grand total differs between ${first.name} and ${name}`);
  }
  if (violations.length > 0) return violations;

  for (const where of recoverableAcrossTables(tables)) {
    violations.push(`${where} is suppressed but can be recovered exactly by combining ${tables.map((t) => t.name).join(" and ")}`);
  }
  return violations;
}

// A variable per hidden value; hidden row totals and the grand total are one variable across all
// tables, since they are the same number. Each line of each table is an equation: parts - total = 0.
function recoverableAcrossTables(tables: readonly { name: string; table: PublishedTable }[]): string[] {
  const variables = new Map<string, number>();
  const labels: string[] = [];
  const variable = (key: string, label: string) => {
    if (!variables.has(key)) {
      variables.set(key, variables.size);
      labels.push(label);
    }
    return variables.get(key)!;
  };

  const equations: Map<number, number>[] = [];
  for (const { name, table } of tables) {
    const R = table.rowLabels.length;
    const C = table.colLabels.length;
    const hiddenAt = (i: number, j: number): number | null => {
      if (i < R && j < C) return table.cells[i]![j] === null ? variable(`${name}[${i},${j}]`, `${name} cell (${table.rowLabels[i]}, ${table.colLabels[j]})`) : null;
      if (i < R) return table.rowTotals[i] === null ? variable(`row ${i}`, `row total "${table.rowLabels[i]}"`) : null;
      if (j < C) return table.colTotals[j] === null ? variable(`${name}[total,${j}]`, `${name} column total "${table.colLabels[j]}"`) : null;
      return table.grandTotal === null ? variable("grand", "the grand total") : null;
    };
    const line = (parts: [number, number][], total: [number, number]) => {
      const eq = new Map<number, number>();
      const add = (v: number | null, c: number) => {
        if (v !== null) eq.set(v, (eq.get(v) ?? 0) + c);
      };
      for (const [i, j] of parts) add(hiddenAt(i, j), 1);
      add(hiddenAt(total[0], total[1]), -1);
      if (eq.size > 0) equations.push(eq);
    };
    for (let i = 0; i <= R; i++) line(Array.from({ length: C }, (_, j) => [i, j] as [number, number]), [i, C]);
    for (let j = 0; j <= C; j++) line(Array.from({ length: R }, (_, i) => [i, j] as [number, number]), [R, j]);
  }

  return determinedVariables(equations, variables.size).map((v) => labels[v]!);
}

type Fraction = readonly [bigint, bigint];

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function fraction(n: bigint, d: bigint): Fraction {
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  return [(sign * n) / g, (sign * d) / g];
}

/**
 * Variables whose value the equations fix exactly: reduce the coefficient matrix to reduced row
 * echelon form; a pivot variable is fixed exactly when its row has no other non-zero coefficient
 * (a free variable could otherwise move it). Only coefficients matter, not the published values.
 */
export function determinedVariables(equations: readonly Map<number, number>[], variableCount: number): number[] {
  const rows: Fraction[][] = equations.map((eq) => {
    const row: Fraction[] = Array.from({ length: variableCount }, () => [0n, 1n] as const);
    for (const [v, c] of eq) row[v] = [BigInt(c), 1n];
    return row;
  });
  const pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < variableCount && r < rows.length; c++) {
    const p = rows.findIndex((row, i) => i >= r && row[c]![0] !== 0n);
    if (p === -1) continue;
    [rows[r], rows[p]] = [rows[p]!, rows[r]!];
    const [pn, pd] = rows[r]![c]!;
    rows[r] = rows[r]!.map(([n, d]) => fraction(n * pd, d * pn));
    for (let i = 0; i < rows.length; i++) {
      const [fn, fd] = rows[i]![c]!;
      if (i === r || fn === 0n) continue;
      rows[i] = rows[i]!.map(([n, d], j) => {
        const [rn, rd] = rows[r]![j]!;
        return fraction(n * fd * rd - fn * rn * d, d * fd * rd);
      });
    }
    pivots.push(c);
    r++;
  }
  return pivots.filter((c, i) => rows[i]!.every(([n], j) => j === c || n === 0n)).sort((a, b) => a - b);
}

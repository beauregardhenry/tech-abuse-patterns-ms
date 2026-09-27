import { assertValidThreshold, DEFAULT_SUPPRESSION_THRESHOLD, findDisclosures, type Coord } from "../shared/disclosure.js";
import type { RawTable, SuppressedTable } from "./types.js";

/** Margins another table has already hidden, which this table must hide too (see runPipeline). */
export interface ForcedMargins {
  rowTotals?: readonly boolean[];
  grandTotal?: boolean;
}

/**
 * Cell suppression for a 2-way table, totals included (see shared/disclosure.ts):
 *
 *   1. Primary: every value -- cell, row total, column total, grand total -- from 1 to k-1 is
 *      hidden. A genuine zero is never hidden.
 *   2. Complementary: while any combination of lines gives a hidden value away (one recoverable
 *      value, or hidden values whose exact sum is below k or pins them to 1), hide one more value
 *      crossing that combination: a cell before a total, the smallest first. Every shown non-zero
 *      value is at least k, so the extra value always makes that combination safe: it either adds
 *      at least k to the exact sum or turns the sum into a difference that pins nothing.
 *
 * Each step hides one more value and the matrix is finite, so this always terminates. Hiding every
 * non-zero value is always safe (zeros cross nothing), so it never runs out of candidates.
 */
export function suppressTable(
  raw: RawTable,
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
  forced: ForcedMargins = {},
): SuppressedTable {
  assertValidThreshold(k);
  const R = raw.rowLabels.length;
  const C = raw.colLabels.length;

  // Augmented matrix: cells, then row totals in column C, column totals in row R, grand total at [R][C].
  const value: number[][] = raw.matrix.map((row) => [...row, row.reduce((a, b) => a + b, 0)]);
  const colTotals = raw.colLabels.map((_, j) => raw.matrix.reduce((sum, row) => sum + row[j]!, 0));
  value.push([...colTotals, colTotals.reduce((a, b) => a + b, 0)]);

  const hidden: boolean[][] = value.map((row) => row.map((v) => v > 0 && v < k));
  for (let i = 0; i < R; i++) {
    if (forced.rowTotals?.[i] && value[i]![C]! > 0) hidden[i]![C] = true;
  }
  if (forced.grandTotal && value[R]![C]! > 0) hidden[R]![C] = true;

  const at = ([i, j]: Coord) => (hidden[i]![j] ? null : value[i]![j]!);
  const grid = { rowLabels: raw.rowLabels, colLabels: raw.colLabels, at };
  const maxSteps = (R + 1) * (C + 1);

  for (let step = 0; ; step++) {
    if (step > maxSteps) {
      throw new Error("suppression did not converge; refusing to emit a table");
    }
    const [unsafe] = findDisclosures(grid, k, true);
    if (!unsafe) break;
    const [vi, vj] = pickVictim(unsafe.crossingShown, value, R, C);
    hidden[vi]![vj] = true;
  }

  return {
    rowDimension: raw.rowDimension,
    colDimension: raw.colDimension,
    rowLabels: raw.rowLabels,
    colLabels: raw.colLabels,
    cells: raw.matrix.map((row, i) => row.map((_, j) => at([i, j]))),
    rowTotals: raw.rowLabels.map((_, i) => at([i, C])),
    colTotals: raw.colLabels.map((_, j) => at([R, j])),
    grandTotal: at([R, C]),
    suppressionThreshold: k,
  };
}

/**
 * The value to hide next, from the shown non-zero values crossing an unsafe combination: a cell
 * before a row or column total, a total before the grand total, then the smallest. Never a zero:
 * zeros carry no disclosive magnitude, and every hidden value being at least 1 is what the
 * disclosure rules rely on.
 */
function pickVictim(candidates: readonly Coord[], value: number[][], R: number, C: number): Coord {
  const rank = ([i, j]: Coord) => (i === R ? 1 : 0) + (j === C ? 1 : 0);
  let best: Coord | null = null;
  for (const c of candidates) {
    if (best === null || rank(c) < rank(best) || (rank(c) === rank(best) && value[c[0]]![c[1]]! < value[best[0]]![best[1]]!)) best = c;
  }
  if (!best) throw new Error("no value left to suppress in an unsafe combination; refusing to emit a table");
  return best;
}

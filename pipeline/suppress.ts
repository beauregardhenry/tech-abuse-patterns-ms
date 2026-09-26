import { assertValidThreshold, augmentedLines, DEFAULT_SUPPRESSION_THRESHOLD, lineViolation, type Coord } from "./disclosure.js";
import type { RawTable, SuppressedTable } from "./types.js";

/** Margins another table has already hidden, which this table must hide too (see runPipeline). */
export interface ForcedMargins {
  rowTotals?: readonly boolean[];
  grandTotal?: boolean;
}

/**
 * Cell suppression for a 2-way table, totals included (see pipeline/disclosure.ts):
 *
 *   1. Primary: every value -- cell, row total, column total, grand total -- from 1 to k-1 is
 *      hidden. A genuine zero is never hidden.
 *   2. Complementary: while any line of the augmented matrix discloses something (exactly one
 *      hidden value, or hidden values whose derived sum is below k), hide one more of its values:
 *      the smallest shown non-zero part, or the line's total if no part qualifies. Every shown
 *      non-zero value is already >= k, so one addition always resolves the line it was chosen for.
 *
 * Each step hides one more value and the matrix is finite, so this always terminates.
 *
 * Known limitation (see docs/PRIVACY.md): this checks each line on its own. It does not run a full
 * linear-programming audit over combinations of lines, which is the harder general problem.
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
  const lines = augmentedLines(raw.rowLabels, raw.colLabels);
  const maxSteps = (R + 1) * (C + 1);

  for (let step = 0; ; step++) {
    if (step > maxSteps) {
      throw new Error("suppression did not converge; refusing to emit a table");
    }
    const unsafe = lines.find((line) => lineViolation(line, at, k) !== null);
    if (!unsafe) break;
    const [vi, vj] = pickVictim(unsafe.parts, unsafe.total, value, hidden);
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
 * Smallest shown non-zero part of the line, falling back to its total. Never a genuine zero:
 * zeros carry no disclosive magnitude, and hiding one would break the "every hidden value is at
 * least 1" reasoning the hidden-mass rule depends on.
 */
function pickVictim(parts: readonly Coord[], total: Coord, value: number[][], hidden: boolean[][]): Coord {
  let best: Coord | null = null;
  for (const [i, j] of parts) {
    if (hidden[i]![j] || value[i]![j] === 0) continue;
    if (best === null || value[i]![j]! < value[best[0]]![best[1]]!) best = [i, j];
  }
  if (best) return best;
  const [ti, tj] = total;
  if (!hidden[ti]![tj] && value[ti]![tj]! > 0) return total;
  throw new Error("no value left to suppress in an unsafe line; refusing to emit a table");
}

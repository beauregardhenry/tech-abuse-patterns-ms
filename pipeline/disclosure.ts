// The disclosure rule shared by suppressTable() and findSuppressionViolations(), so the algorithm
// and the audit can never disagree about what "safe" means.
//
// A 2-way table is treated as an (R+1) x (C+1) "augmented" matrix whose last row and column are
// the totals, and whose bottom-right corner is the grand total. Every row and every column of that
// matrix -- including the totals row and the totals column -- is a line where the parts sum to the
// total. A viewer who sees some values of a line can derive the rest by subtraction, so for every
// line:
//
//   - exactly one hidden value is always recoverable (total minus the shown parts, or the sum of
//     the parts), so a line must hide none of its values or at least two;
//   - when the total is shown, "total minus the shown parts" is the exact combined size of the
//     hidden parts. That derived number is itself a count, so it has to meet the threshold every
//     displayed count meets: at least k. Without this, two hidden cells whose derived sum is 2
//     must both be exactly 1 (zeros are never hidden, so every hidden value is at least 1).
//
// Treating totals as cells is what protects a hidden total: e.g. a hidden row total is one part of
// the totals column, whose total is the grand total.

export const DEFAULT_SUPPRESSION_THRESHOLD = 11;

/** A threshold below 2 (or NaN, or a fraction) suppresses nothing; refuse it rather than fail open. */
export function assertValidThreshold(k: number): void {
  if (!Number.isInteger(k) || k < 2) {
    throw new Error(`suppression threshold k must be an integer >= 2 (got ${k}); refusing to run with suppression disabled`);
  }
}

export type Coord = readonly [number, number];

export interface Line {
  label: string;
  parts: Coord[];
  total: Coord;
}

/** Every line of the augmented matrix for a table with the given row/column labels. */
export function augmentedLines(rowLabels: readonly string[], colLabels: readonly string[]): Line[] {
  const R = rowLabels.length;
  const C = colLabels.length;
  const lines: Line[] = [];
  for (let i = 0; i <= R; i++) {
    lines.push({
      label: i < R ? `row "${rowLabels[i]}"` : "column totals",
      parts: colLabels.map((_, j) => [i, j] as const),
      total: [i, C],
    });
  }
  for (let j = 0; j <= C; j++) {
    lines.push({
      label: j < C ? `column "${colLabels[j]}"` : "row totals",
      parts: rowLabels.map((_, i) => [i, j] as const),
      total: [R, j],
    });
  }
  return lines;
}

/**
 * Why a line discloses something, or null if it doesn't. `at` returns the value a viewer sees at a
 * coordinate of the augmented matrix, or null if it is suppressed.
 */
export function lineViolation(line: Line, at: (coord: Coord) => number | null, k: number): string | null {
  const parts = line.parts.map(at);
  const total = at(line.total);
  const hidden = parts.filter((v) => v === null).length + (total === null ? 1 : 0);
  const shownPartsSum = parts.reduce<number>((sum, v) => sum + (v ?? 0), 0);

  if (hidden === 0) {
    return shownPartsSum === total ? null : `${line.label}: shown values sum to ${shownPartsSum} but the total shows ${total}`;
  }
  if (hidden === 1) {
    return `${line.label}: exactly one suppressed value, recoverable by subtraction`;
  }
  if (total !== null) {
    const hiddenMass = total - shownPartsSum;
    if (hiddenMass < k) {
      return `${line.label}: suppressed values add up to ${hiddenMass} (total minus shown values), below k=${k}`;
    }
  }
  return null;
}

import type { RawTable, SuppressedTable } from "./types.js";

export const DEFAULT_SUPPRESSION_THRESHOLD = 11;

/**
 * Cell suppression for a 2-way table: primary suppression (rule 1) plus
 * complementary/secondary suppression against back-calculation from a
 * displayed row total, column total, or grand total (rule 2).
 *
 * Known limitation (see docs/PRIVACY.md): this protects against recovering
 * a single hidden cell from ONE margin (its row, its column, or the grand
 * total) at a time. It does not run a full linear-programming disclosure
 * audit across all possible combinations of margins in higher-dimensional
 * tables — that is a harder problem and is called out as an open item for
 * review with a statistician/the partner org before any real data is used.
 */
export function suppressTable(raw: RawTable, k: number = DEFAULT_SUPPRESSION_THRESHOLD): SuppressedTable {
  const numRows = raw.rowLabels.length;
  const numCols = raw.colLabels.length;

  const suppressed: boolean[][] = raw.matrix.map((row) => row.map((v) => v > 0 && v < k));

  const rowTotalsRaw = raw.matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotalsRaw = raw.colLabels.map((_, j) => raw.matrix.reduce((a, row) => a + row[j]!, 0));
  const grandTotalRaw = rowTotalsRaw.reduce((a, b) => a + b, 0);

  const rowTotalSuppressed = rowTotalsRaw.map((v) => v > 0 && v < k);
  const colTotalSuppressed = colTotalsRaw.map((v) => v > 0 && v < k);
  let grandTotalSuppressed = grandTotalRaw > 0 && grandTotalRaw < k;

  const MAX_ITERATIONS = 50;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;

    // Row-level: a lone suppressed cell in a row whose total is shown can be
    // recovered by subtraction, unless we hide a second cell in that row
    // (or, failing that, the row total itself).
    for (let i = 0; i < numRows; i++) {
      if (rowTotalSuppressed[i]) continue;
      const suppressedCols = suppressed[i]!.reduce((n, s) => n + (s ? 1 : 0), 0);
      if (suppressedCols !== 1) continue;
      const victim = smallestUnsuppressedNonzero(raw.matrix[i]!, suppressed[i]!);
      if (victim !== -1) {
        suppressed[i]![victim] = true;
      } else {
        rowTotalSuppressed[i] = true;
      }
      changed = true;
    }

    // Column-level: same logic, transposed.
    for (let j = 0; j < numCols; j++) {
      if (colTotalSuppressed[j]) continue;
      const colValues = raw.matrix.map((row) => row[j]!);
      const colFlags = suppressed.map((row) => row[j]!);
      const suppressedRows = colFlags.reduce((n, s) => n + (s ? 1 : 0), 0);
      if (suppressedRows !== 1) continue;
      const victim = smallestUnsuppressedNonzero(colValues, colFlags);
      if (victim !== -1) {
        suppressed[victim]![j] = true;
      } else {
        colTotalSuppressed[j] = true;
      }
      changed = true;
    }

    // Grand-total-level: a single suppressed cell anywhere in the table,
    // with the grand total shown, is recoverable the same way.
    if (!grandTotalSuppressed) {
      const flatValues: number[] = [];
      const flatFlags: boolean[] = [];
      const flatCoords: Array<[number, number]> = [];
      for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) {
          flatValues.push(raw.matrix[i]![j]!);
          flatFlags.push(suppressed[i]![j]!);
          flatCoords.push([i, j]);
        }
      }
      const suppressedCount = flatFlags.reduce((n, s) => n + (s ? 1 : 0), 0);
      if (suppressedCount === 1) {
        const victim = smallestUnsuppressedNonzero(flatValues, flatFlags);
        if (victim !== -1) {
          const [vi, vj] = flatCoords[victim]!;
          suppressed[vi]![vj] = true;
        } else {
          grandTotalSuppressed = true;
        }
        changed = true;
      }
    }

    if (!changed) break;
  }

  const cells = raw.matrix.map((row, i) => row.map((v, j) => (suppressed[i]![j] ? null : v)));
  const rowTotals = rowTotalsRaw.map((v, i) => (rowTotalSuppressed[i] ? null : v));
  const colTotals = colTotalsRaw.map((v, j) => (colTotalSuppressed[j] ? null : v));
  const grandTotal = grandTotalSuppressed ? null : grandTotalRaw;

  return {
    rowDimension: raw.rowDimension,
    colDimension: raw.colDimension,
    rowLabels: raw.rowLabels,
    colLabels: raw.colLabels,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
    suppressionThreshold: k,
  };
}

/** Smallest visible, non-zero, not-already-suppressed value; never picks a genuine zero (rule: zeros carry no disclosive magnitude and stay visible). Returns -1 if none exists. */
function smallestUnsuppressedNonzero(values: readonly number[], suppressedFlags: readonly boolean[]): number {
  let bestIdx = -1;
  let bestValue = Infinity;
  for (let idx = 0; idx < values.length; idx++) {
    if (suppressedFlags[idx]) continue;
    if (values[idx] === 0) continue;
    if (values[idx]! < bestValue) {
      bestValue = values[idx]!;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

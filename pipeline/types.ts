export interface RawTable {
  rowDimension: string;
  colDimension: string;
  rowLabels: string[];
  colLabels: string[];
  /** matrix[i][j] = raw, unsuppressed count for (rowLabels[i], colLabels[j]). */
  matrix: number[][];
}

export interface SuppressedTable {
  rowDimension: string;
  colDimension: string;
  rowLabels: string[];
  colLabels: string[];
  /** null = suppressed cell; never null for a genuine zero. */
  cells: (number | null)[][];
  rowTotals: (number | null)[];
  colTotals: (number | null)[];
  grandTotal: number | null;
  suppressionThreshold: number;
}

/** A SuppressedTable plus the labelling rules 4/5 in docs/PRIVACY.md require on every view/export. */
export interface LabelledOutput<T> {
  synthetic: true;
  /** Coarse (day-level) date the underlying synthetic dataset was generated — never a live timestamp. */
  dataAsOf: string;
  data: T;
}

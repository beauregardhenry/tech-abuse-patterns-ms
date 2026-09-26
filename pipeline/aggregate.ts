import type { IntakeRecord } from "../schema/index.js";
import type { RawTable } from "./types.js";

export interface Dimension {
  name: string;
  labels: readonly string[];
  keyOf: (record: IntakeRecord) => string;
}

/** Cross-tabulates records into raw (unsuppressed) counts for two dimensions. */
export function buildCrossTab(records: readonly IntakeRecord[], rows: Dimension, cols: Dimension): RawTable {
  const matrix = rows.labels.map(() => cols.labels.map(() => 0));

  for (const record of records) {
    const i = rows.labels.indexOf(rows.keyOf(record));
    const j = cols.labels.indexOf(cols.keyOf(record));
    if (i === -1 || j === -1) continue; // outside the requested slice (e.g. a different quarter)
    matrix[i]![j] = matrix[i]![j]! + 1;
  }

  return {
    rowDimension: rows.name,
    colDimension: cols.name,
    rowLabels: [...rows.labels],
    colLabels: [...cols.labels],
    matrix,
  };
}

/** A one-way distribution, modeled as a cross-tab against a single implicit "all" column so it reuses the same suppression algorithm. */
export function buildSeries(records: readonly IntakeRecord[], dimension: Dimension): RawTable {
  return buildCrossTab(records, dimension, { name: "all", labels: ["all"], keyOf: () => "all" });
}

export function filterByQuarter(records: readonly IntakeRecord[], quarter: string): IntakeRecord[] {
  return records.filter((r) => r.quarter === quarter);
}

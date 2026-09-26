// Local copy of the JSON contract the dashboard consumes from
// dashboard/data/aggregates.SYNTHETIC.json (produced by
// scripts/build-dashboard-data.ts via pipeline/index.ts).
//
// Deliberately NOT imported from ../pipeline: the dashboard is a separate
// deployable that consumes a data contract over fetch(), not Node code
// that shares a build with the pipeline. Keeping its own copy also keeps
// this directory self-contained for its own tsc project (see
// dashboard/tsconfig.json) and enforces rule 5 architecturally — the
// rendering layer has no import path back into record-level code at all.
//
// If pipeline/types.ts, pipeline/outcomes.ts, or pipeline/stats.ts change
// shape, this file must be updated to match.

export interface SuppressedTable {
  rowDimension: string;
  colDimension: string;
  rowLabels: string[];
  colLabels: string[];
  cells: (number | null)[][];
  rowTotals: (number | null)[];
  colTotals: (number | null)[];
  grandTotal: number | null;
  suppressionThreshold: number;
}

export interface SuppressedFlagCount {
  label: string;
  count: number | null;
}

export interface SuppressedStat {
  label: string;
  n: number | null;
  meanDays: number | null;
}

export interface DashboardAggregates {
  abuseTypeByQuarter: SuppressedTable;
  abuseTypeByRegion: SuppressedTable;
  abuseTypeTotals: SuppressedTable;
  outcomeCounts: SuppressedFlagCount[];
  daysToSafetyPlanByQuarter: SuppressedStat[];
  suppressionThreshold: number;
}

export interface LabelledOutput<T> {
  synthetic: true;
  dataAsOf: string;
  data: T;
}

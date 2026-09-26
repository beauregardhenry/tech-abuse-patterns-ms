import { ABUSE_TYPES, REGIONS, type IntakeRecord } from "../schema/index.js";
import { buildCrossTab, buildSeries, type Dimension } from "./aggregate.js";
import { DEFAULT_SUPPRESSION_THRESHOLD, suppressTable } from "./suppress.js";
import { findSuppressionViolations } from "./audit.js";
import { countOutcomeFlags, type SuppressedFlagCount } from "./outcomes.js";
import { computeDaysToSafetyPlanStats, type SuppressedStat } from "./stats.js";
import { labelSynthetic } from "./label.js";
import type { LabelledOutput, SuppressedTable } from "./types.js";

export * from "./types.js";
export * from "./aggregate.js";
export * from "./suppress.js";
export * from "./audit.js";
export * from "./outcomes.js";
export * from "./stats.js";
export * from "./label.js";

export interface DashboardAggregates {
  abuseTypeByQuarter: SuppressedTable;
  abuseTypeByRegion: SuppressedTable;
  /** Statewide total per abuse_type, collapsed across region and quarter — the legislators' "numbers for a bill" view. */
  abuseTypeTotals: SuppressedTable;
  outcomeCounts: SuppressedFlagCount[];
  daysToSafetyPlanByQuarter: SuppressedStat[];
  suppressionThreshold: number;
}

function abuseTypeDimension(): Dimension {
  return { name: "abuse_type", labels: ABUSE_TYPES, keyOf: (r) => r.abuse_type };
}

function regionDimension(): Dimension {
  return { name: "region", labels: REGIONS, keyOf: (r) => r.region };
}

function quarterDimension(quarters: readonly string[]): Dimension {
  return { name: "quarter", labels: quarters, keyOf: (r) => r.quarter };
}

/**
 * Runs the full generate -> aggregate -> suppress -> audit path and returns
 * only the suppressed aggregates the dashboard is allowed to render (rule
 * 5: the rendering layer never sees record-level data). Throws if any
 * suppressed table fails the audit — this is the hard enforcement point,
 * not a suggestion the caller can skip.
 */
export function runPipeline(
  records: readonly IntakeRecord[],
  quarters: readonly string[],
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
): LabelledOutput<DashboardAggregates> {
  const abuseTypeByQuarter = suppressTable(buildCrossTab(records, abuseTypeDimension(), quarterDimension(quarters)), k);
  const abuseTypeByRegion = suppressTable(buildCrossTab(records, abuseTypeDimension(), regionDimension()), k);
  const abuseTypeTotals = suppressTable(buildSeries(records, abuseTypeDimension()), k);

  for (const table of [abuseTypeByQuarter, abuseTypeByRegion, abuseTypeTotals]) {
    const violations = findSuppressionViolations(table);
    if (violations.length > 0) {
      throw new Error(`pipeline refused to emit an unsafe table (${table.rowDimension} x ${table.colDimension}): ${violations.join("; ")}`);
    }
  }

  const outcomeCounts = countOutcomeFlags(records, k);
  const daysToSafetyPlanByQuarter = computeDaysToSafetyPlanStats(records, quarterDimension(quarters), k);

  return labelSynthetic({
    abuseTypeByQuarter,
    abuseTypeByRegion,
    abuseTypeTotals,
    outcomeCounts,
    daysToSafetyPlanByQuarter,
    suppressionThreshold: k,
  });
}

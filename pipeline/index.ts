import { ABUSE_TYPES, IntakeRecordSchema, REGIONS, type IntakeRecord } from "../schema/index.js";
import { buildCrossTab, type Dimension } from "./aggregate.js";
import { assertValidThreshold, DEFAULT_SUPPRESSION_THRESHOLD } from "./disclosure.js";
import { suppressTable } from "./suppress.js";
import { findSuppressionViolations } from "./audit.js";
import { countOutcomeFlags, type SuppressedFlagCount } from "./outcomes.js";
import { computeDaysToSafetyPlanStats, type SuppressedStat } from "./stats.js";
import { labelSynthetic } from "./label.js";
import type { LabelledOutput, RawTable, SuppressedTable } from "./types.js";

export * from "./types.js";
export * from "./aggregate.js";
export * from "./disclosure.js";
export * from "./suppress.js";
export * from "./audit.js";
export * from "./outcomes.js";
export * from "./stats.js";
export * from "./label.js";

export interface DashboardAggregates {
  abuseTypeByQuarter: SuppressedTable;
  abuseTypeByRegion: SuppressedTable;
  /** Statewide total per abuse_type — the legislators' "numbers for a bill" view. Derived from the cross-tabs' shared row totals, never suppressed separately. */
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

/** Schema-validates every record at the pipeline's input boundary, failing closed. */
function validateRecords(records: readonly unknown[]): IntakeRecord[] {
  return records.map((candidate, index) => {
    const result = IntakeRecordSchema.safeParse(candidate);
    if (!result.success) {
      // Field paths and issue codes only, never values: a rejected record's content is exactly
      // what this pipeline exists to keep out of every output, error messages and logs included.
      const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(record)"}: ${issue.code}`);
      throw new Error(`record ${index} failed schema validation (${issues.join(", ")})`);
    }
    return result.data;
  });
}

/**
 * Suppresses tables that share the same row totals and grand total so those shared values end up
 * hidden identically in every table. Suppressing them independently would let a total hidden in
 * one table be read straight off another. Repeats until no table hides a shared total the others
 * show; the hidden set only grows, so this ends within R + 2 rounds.
 */
function suppressWithSharedRowMargins(raws: readonly RawTable[], k: number): SuppressedTable[] {
  const rowTotal = (raw: RawTable, i: number) => raw.matrix[i]!.reduce((a, b) => a + b, 0);
  const first = raws[0]!;
  for (const raw of raws) {
    const same =
      raw.rowLabels.length === first.rowLabels.length &&
      raw.rowLabels.every((label, i) => label === first.rowLabels[i] && rowTotal(raw, i) === rowTotal(first, i));
    if (!same) throw new Error("tables expected to share row totals do not; refusing to suppress them");
  }

  let rowTotals: boolean[] = first.rowLabels.map(() => false);
  let grandTotal = false;
  for (let round = 0; round <= first.rowLabels.length + 1; round++) {
    const tables: SuppressedTable[] = raws.map((raw) => suppressTable(raw, k, { rowTotals, grandTotal }));
    const nextRows = rowTotals.map((forced, i) => forced || tables.some((t) => t.rowTotals[i] === null));
    const nextGrand: boolean = grandTotal || tables.some((t) => t.grandTotal === null);
    if (nextGrand === grandTotal && nextRows.every((forced, i) => forced === rowTotals[i])) return tables;
    rowTotals = nextRows;
    grandTotal = nextGrand;
  }
  throw new Error("shared-margin suppression did not converge; refusing to emit tables");
}

/**
 * Every record with a days_to_safety_plan value also has a safety_plan outcome (the schema enforces
 * it), so when the safety_plan count and every quarter's sample size are all shown, "safety plans
 * with no recorded day count" = count - sum(n) is derivable. Suppress the count if that is small.
 */
function protectUnmeasuredSafetyPlans(outcomes: SuppressedFlagCount[], stats: readonly SuppressedStat[], k: number): SuppressedFlagCount[] {
  const sizes = stats.map((s) => s.n);
  return outcomes.map((outcome) => {
    if (outcome.label !== "safety_plan" || outcome.count === null || sizes.some((n) => n === null)) return outcome;
    const unmeasured = outcome.count - sizes.reduce<number>((sum, n) => sum + (n ?? 0), 0);
    return unmeasured > 0 && unmeasured < k ? { ...outcome, count: null } : outcome;
  });
}

function seriesFromRowTotals(table: SuppressedTable): SuppressedTable {
  return {
    rowDimension: table.rowDimension,
    colDimension: "all",
    rowLabels: table.rowLabels,
    colLabels: ["all"],
    cells: table.rowTotals.map((v) => [v]),
    rowTotals: table.rowTotals,
    colTotals: [table.grandTotal],
    grandTotal: table.grandTotal,
    suppressionThreshold: table.suppressionThreshold,
  };
}

/**
 * Runs validate -> aggregate -> suppress -> audit and returns only the suppressed aggregates the
 * dashboard is allowed to render (rule 5: the rendering layer never sees record-level data).
 * Throws on any invalid record, invalid threshold, or table that fails the audit — this is the
 * hard enforcement point, not a suggestion the caller can skip.
 */
export function runPipeline(
  input: readonly unknown[],
  quarters: readonly string[],
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
): LabelledOutput<DashboardAggregates> {
  assertValidThreshold(k);
  const records = validateRecords(input);

  // Every table must see the same records. A record outside `quarters` would be counted by the
  // region table but not the quarter table, and the difference between their totals would be a
  // derivable (possibly small) count.
  const outOfRange = records.findIndex((r) => !quarters.includes(r.quarter));
  if (outOfRange !== -1) {
    throw new Error(`record ${outOfRange} has a quarter outside the requested quarters; refusing to build inconsistent tables`);
  }

  const [abuseTypeByQuarter, abuseTypeByRegion] = suppressWithSharedRowMargins(
    [
      buildCrossTab(records, abuseTypeDimension(), quarterDimension(quarters)),
      buildCrossTab(records, abuseTypeDimension(), regionDimension()),
    ],
    k,
  );
  const abuseTypeTotals = seriesFromRowTotals(abuseTypeByRegion);

  for (const table of [abuseTypeByQuarter, abuseTypeByRegion, abuseTypeTotals]) {
    const violations = findSuppressionViolations(table);
    if (violations.length > 0) {
      throw new Error(`pipeline refused to emit an unsafe table (${table.rowDimension} x ${table.colDimension}): ${violations.join("; ")}`);
    }
  }

  const daysToSafetyPlanByQuarter = computeDaysToSafetyPlanStats(
    records,
    quarterDimension(quarters),
    k,
    abuseTypeByQuarter.colTotals,
  );
  const outcomeCounts = protectUnmeasuredSafetyPlans(
    countOutcomeFlags(records, k, abuseTypeByRegion.grandTotal),
    daysToSafetyPlanByQuarter,
    k,
  );

  return labelSynthetic({
    abuseTypeByQuarter,
    abuseTypeByRegion,
    abuseTypeTotals,
    outcomeCounts,
    daysToSafetyPlanByQuarter,
    suppressionThreshold: k,
  });
}

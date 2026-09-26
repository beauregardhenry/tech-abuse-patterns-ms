import type { IntakeRecord } from "../schema/index.js";
import { assertValidThreshold, DEFAULT_SUPPRESSION_THRESHOLD } from "./disclosure.js";
import type { Dimension } from "./aggregate.js";

export interface SuppressedStat {
  label: string;
  /** Sample size behind the stat. Null when suppressed (the same k rule applied to every other count). */
  n: number | null;
  medianDays: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Median days-to-safety-plan per dimension label. A median rather than a mean: with a mean, one
 * extreme record can dominate the published number (and so reveal itself); a median of n >= k
 * values can't be moved by any single record past its neighbours.
 *
 * `n` is threshold-suppressed (rule 1). `shownTotals[i]` is the record count the dashboard shows
 * for the same label (the per-quarter column total); showing both makes "records in this quarter
 * WITHOUT a measured value" = total - n derivable, so the stat is also suppressed when that
 * complement is a small non-zero number. No combined total across labels is shown, so there is no
 * margin among these for complementary suppression to protect (see docs/PRIVACY.md).
 */
export function computeDaysToSafetyPlanStats(
  records: readonly IntakeRecord[],
  dimension: Dimension,
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
  shownTotals: readonly (number | null)[] = [],
): SuppressedStat[] {
  assertValidThreshold(k);
  return dimension.labels.map((label, i) => {
    const measured = records.filter((r) => dimension.keyOf(r) === label && r.days_to_safety_plan !== null);
    const n = measured.length;
    const shownTotal = shownTotals[i] ?? null;
    const complement = shownTotal === null ? 0 : shownTotal - n;
    if ((n > 0 && n < k) || (complement > 0 && complement < k)) {
      return { label, n: null, medianDays: null };
    }
    if (n === 0) {
      return { label, n: 0, medianDays: null };
    }
    const days = measured.map((r) => r.days_to_safety_plan!);
    return { label, n, medianDays: Math.round(median(days) * 10) / 10 };
  });
}

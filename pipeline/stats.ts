import type { IntakeRecord } from "../schema/index.js";
import { DEFAULT_SUPPRESSION_THRESHOLD } from "./suppress.js";
import type { Dimension } from "./aggregate.js";

export interface SuppressedStat {
  label: string;
  /** Sample size behind the stat. Null when suppressed (the same k rule applied to every other count). */
  n: number | null;
  meanDays: number | null;
}

/**
 * Mean days-to-safety-plan per dimension label, independently threshold-
 * suppressed (rule 1). There is no combined "all labels" total shown
 * alongside these, so — unlike the cross-tabs in suppress.ts — there is no
 * margin for a hidden value to be recovered from; complementary
 * suppression does not apply here. If a combined total is ever added,
 * this must be revisited (see docs/PRIVACY.md).
 */
export function computeDaysToSafetyPlanStats(
  records: readonly IntakeRecord[],
  dimension: Dimension,
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
): SuppressedStat[] {
  return dimension.labels.map((label) => {
    const measured = records.filter((r) => dimension.keyOf(r) === label && r.days_to_safety_plan !== null);
    const n = measured.length;
    if (n > 0 && n < k) {
      return { label, n: null, meanDays: null };
    }
    if (n === 0) {
      return { label, n: 0, meanDays: null };
    }
    const mean = measured.reduce((sum, r) => sum + r.days_to_safety_plan!, 0) / n;
    return { label, n, meanDays: Math.round(mean * 10) / 10 };
  });
}

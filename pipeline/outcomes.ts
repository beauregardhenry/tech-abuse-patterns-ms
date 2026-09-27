import { OUTCOMES, type IntakeRecord, type Outcome } from "../schema/index.js";
import { assertValidThreshold, DEFAULT_SUPPRESSION_THRESHOLD } from "../shared/disclosure.js";

export interface SuppressedFlagCount {
  label: Outcome;
  count: number | null;
}

/**
 * Each outcome is an independent, non-exclusive flag (a record can carry more than one), so there
 * is no coherent "total across outcomes" and no margin to protect among them. Each count is
 * threshold-suppressed on its own (rule 1).
 *
 * `shownTotal` is the record total the dashboard displays alongside these counts (the grand
 * total). Showing both makes "records WITHOUT this outcome" = shownTotal - count derivable, so a
 * count is also suppressed when that complement is a small non-zero number.
 */
export function countOutcomeFlags(
  records: readonly IntakeRecord[],
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
  shownTotal: number | null = null,
): SuppressedFlagCount[] {
  assertValidThreshold(k);
  return OUTCOMES.map((outcome) => {
    const raw = records.filter((r) => r.outcome.includes(outcome)).length;
    const small = raw > 0 && raw < k;
    const complement = shownTotal === null ? 0 : shownTotal - raw;
    const smallComplement = complement > 0 && complement < k;
    return { label: outcome, count: small || smallComplement ? null : raw };
  });
}

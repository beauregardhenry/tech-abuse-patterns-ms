import { OUTCOMES, type IntakeRecord, type Outcome } from "../schema/index.js";
import { DEFAULT_SUPPRESSION_THRESHOLD } from "./suppress.js";

export interface SuppressedFlagCount {
  label: Outcome;
  count: number | null;
}

/**
 * Each outcome is an independent, non-exclusive flag (a record can carry
 * more than one), so there is no coherent "total across outcomes" — summing
 * them would double-count records. Each flag is therefore threshold-
 * suppressed (rule 1) on its own; there is no margin to protect against
 * back-calculation because no combined total is ever displayed alongside
 * them (see docs/PRIVACY.md).
 */
export function countOutcomeFlags(
  records: readonly IntakeRecord[],
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
): SuppressedFlagCount[] {
  return OUTCOMES.map((outcome) => {
    const raw = records.filter((r) => r.outcome.includes(outcome)).length;
    const suppressed = raw > 0 && raw < k;
    return { label: outcome, count: suppressed ? null : raw };
  });
}

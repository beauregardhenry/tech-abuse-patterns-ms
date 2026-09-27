import { tableViolations } from "../shared/disclosure.js";
import type { SuppressedTable } from "./types.js";

/**
 * Checks a published table the way a viewer would attack it -- using only the values it shows --
 * against the disclosure rules in shared/disclosure.ts, every combination of lines included.
 * Returns a list of violations; empty means compliant. This is the enforcement point rule 5 calls
 * for: runPipeline refuses to emit any table this rejects, rather than trusting suppressTable()
 * blindly. dashboard/validate.ts runs the same check on the data file before rendering it.
 */
export function findSuppressionViolations(table: SuppressedTable): string[] {
  return tableViolations(table);
}

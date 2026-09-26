import { augmentedLines, lineViolation, type Coord } from "./disclosure.js";
import type { SuppressedTable } from "./types.js";

/**
 * Checks a published table the way a viewer would attack it -- using only the values it shows --
 * against rules 1 and 2 (see pipeline/disclosure.ts). Returns a list of violations; empty means
 * compliant. This is the enforcement point rule 5 calls for: runPipeline refuses to emit any table
 * this rejects, rather than trusting suppressTable() blindly.
 */
export function findSuppressionViolations(table: SuppressedTable): string[] {
  const k = table.suppressionThreshold;
  if (!Number.isInteger(k) || k < 2) {
    return [`suppression threshold k=${k} is not an integer >= 2, so nothing is actually protected`];
  }

  const R = table.rowLabels.length;
  const C = table.colLabels.length;
  const at = ([i, j]: Coord): number | null => {
    if (i < R && j < C) return table.cells[i]![j]!;
    if (i < R) return table.rowTotals[i]!;
    if (j < C) return table.colTotals[j]!;
    return table.grandTotal;
  };

  const violations: string[] = [];
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= C; j++) {
      const v = at([i, j]);
      if (v !== null && v > 0 && v < k) {
        const where = i < R && j < C ? `cell (${table.rowLabels[i]}, ${table.colLabels[j]})` : i < R ? `row total "${table.rowLabels[i]}"` : j < C ? `column total "${table.colLabels[j]}"` : "grand total";
        violations.push(`${where} = ${v} is below k=${k} but not suppressed`);
      }
    }
  }
  for (const line of augmentedLines(table.rowLabels, table.colLabels)) {
    const violation = lineViolation(line, at, k);
    if (violation) violations.push(violation);
  }
  return violations;
}

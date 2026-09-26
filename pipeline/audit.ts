import type { SuppressedTable } from "./types.js";

/**
 * Verifies the two privacy invariants (rules 1 and 2) hold on a table that
 * has already been through suppressTable(). Returns a list of violations —
 * empty means compliant. This is the enforcement point rule 5 calls for:
 * the rendering layer and any export step should refuse to proceed on any
 * non-empty result from this function, rather than trust suppressTable()
 * blindly.
 */
export function findSuppressionViolations(table: SuppressedTable): string[] {
  const violations: string[] = [];
  const k = table.suppressionThreshold;

  for (let i = 0; i < table.rowLabels.length; i++) {
    for (let j = 0; j < table.colLabels.length; j++) {
      const value = table.cells[i]![j];
      if (value !== null && value > 0 && value < k) {
        violations.push(`cell (${table.rowLabels[i]}, ${table.colLabels[j]}) = ${value} is below k=${k} but not suppressed`);
      }
    }
  }

  for (let i = 0; i < table.rowLabels.length; i++) {
    if (table.rowTotals[i] === null) continue;
    const suppressedCount = table.cells[i]!.filter((v) => v === null).length;
    if (suppressedCount === 1) {
      violations.push(`row "${table.rowLabels[i]}" has exactly one suppressed cell while its total is shown — back-calculable`);
    }
  }

  for (let j = 0; j < table.colLabels.length; j++) {
    if (table.colTotals[j] === null) continue;
    const suppressedCount = table.cells.filter((row) => row[j] === null).length;
    if (suppressedCount === 1) {
      violations.push(`column "${table.colLabels[j]}" has exactly one suppressed cell while its total is shown — back-calculable`);
    }
  }

  if (table.grandTotal !== null) {
    const suppressedCount = table.cells.flat().filter((v) => v === null).length;
    if (suppressedCount === 1) {
      violations.push("exactly one suppressed cell in the whole table while the grand total is shown — back-calculable");
    }
  }

  return violations;
}

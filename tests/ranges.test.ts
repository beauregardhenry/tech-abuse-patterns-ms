import { describe, expect, it } from "vitest";
import { suppressTable } from "../pipeline/suppress.js";
import { hiddenRanges, minimize, publishedSystem } from "../scripts/ranges.js";
import type { SuppressedTable } from "../pipeline/types.js";

// Brute force: try every whole-number value for the hidden cells, keep the assignments that
// reproduce every shown value, and record each hidden value's smallest and largest.
function bruteForceRanges(table: SuppressedTable, truth: number[][]): Map<string, [number, number]> {
  const C = truth[0]!.length;
  const hiddenCells = truth.flatMap((row, i) => row.map((_, j) => [i, j] as const)).filter(([i, j]) => table.cells[i]![j] === null);
  const cap = table.grandTotal!;
  const cells = truth.map((row, i) => row.map((v, j) => (table.cells[i]![j] === null ? 0 : v)));
  const found = new Map<string, [number, number]>();
  const record = (label: string, v: number) => {
    const r = found.get(label);
    found.set(label, r ? [Math.min(r[0], v), Math.max(r[1], v)] : [v, v]);
  };
  const visit = (h: number) => {
    if (h < hiddenCells.length) {
      const [i, j] = hiddenCells[h]!;
      for (let v = 1; v <= cap; v++) {
        cells[i]![j] = v;
        visit(h + 1);
      }
      return;
    }
    const rowTotals = cells.map((row) => row.reduce((a, b) => a + b, 0));
    const colTotals = Array.from({ length: C }, (_, j) => cells.reduce((s, row) => s + row[j]!, 0));
    const grand = rowTotals.reduce((a, b) => a + b, 0);
    const matches =
      rowTotals.every((t, i) => table.rowTotals[i] === null || table.rowTotals[i] === t) &&
      colTotals.every((t, j) => table.colTotals[j] === null || table.colTotals[j] === t) &&
      table.grandTotal === grand &&
      rowTotals.every((t, i) => table.rowTotals[i] !== null || t >= 1) &&
      colTotals.every((t, j) => table.colTotals[j] !== null || t >= 1);
    if (!matches) return;
    for (const [i, j] of hiddenCells) record(`t: ${table.rowLabels[i]} / ${table.colLabels[j]}`, cells[i]![j]!);
    rowTotals.forEach((t, i) => table.rowTotals[i] === null && record(`total: ${table.rowLabels[i]}`, t));
    colTotals.forEach((t, j) => table.colTotals[j] === null && record(`t: total ${table.colLabels[j]}`, t));
  };
  visit(0);
  return found;
}

describe("hiddenRanges — how narrowly a viewer can bound suppressed values", () => {
  it("solves small linear programs correctly, including unbounded ones", () => {
    // min y0 + y1 s.t. y0 - y1 = 2: optimum 2 at (2, 0).
    expect(minimize([[1, -1]], [2], [1, 1])).toEqual({ value: 2, unbounded: false });
    // min -y0 s.t. y0 - y1 = 2: y0 can grow without limit.
    expect(minimize([[1, -1]], [2], [-1, 0]).unbounded).toBe(true);
    // Redundant equations are fine.
    expect(minimize([[1, 1], [2, 2]], [4, 8], [1, 0]).value).toBeCloseTo(0);
  });

  it("matches brute-force enumeration on small random tables", () => {
    let seed = 3;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    let compared = 0;
    for (let run = 0; compared < 25 && run < 400; run++) {
      const k = 3 + (run % 3);
      const cols = 2 + (run % 2);
      const truth = Array.from({ length: 2 }, () => Array.from({ length: cols }, () => Math.floor(next() * 7)));
      const table = suppressTable(
        { rowDimension: "r", colDimension: "c", rowLabels: ["a", "b"], colLabels: truth[0]!.map((_, j) => `c${j}`), matrix: truth },
        k,
      );
      const hiddenCells = table.cells.flat().filter((v) => v === null).length;
      if (table.grandTotal === null || table.grandTotal > 24 || hiddenCells === 0 || hiddenCells > 3) continue;
      const expected = bruteForceRanges(table, truth);
      const actual = hiddenRanges(publishedSystem([{ name: "t", table }]));
      for (const { label, min, max } of actual) {
        expect([min, max], `run ${run} ${label}`).toEqual(expected.get(label));
      }
      compared++;
    }
    expect(compared).toBe(25);
  });
});

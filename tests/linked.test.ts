import { describe, expect, it } from "vitest";
import { determinedVariables, linkedTableViolations } from "../shared/linked.js";

describe("determinedVariables — exact solving over the rationals", () => {
  it("finds variables two equations pin down", () => {
    // x + y = ?, x - y = ?  -> both fixed.
    const eqs = [new Map([[0, 1], [1, 1]]), new Map([[0, 1], [1, -1]])];
    expect(determinedVariables(eqs, 2)).toEqual([0, 1]);
  });

  it("leaves variables on a cycle free, and finds one hanging off it", () => {
    // a+b, c+d, a+c, b+d: a 2x2 block of hidden cells can shift around its cycle, so none is fixed.
    const cycle = [new Map([[0, 1], [1, 1]]), new Map([[2, 1], [3, 1]]), new Map([[0, 1], [2, 1]]), new Map([[1, 1], [3, 1]])];
    expect(determinedVariables(cycle, 4)).toEqual([]);
    // Add e, alone in its own equation: fixed.
    expect(determinedVariables([...cycle, new Map([[4, 1]])], 5)).toEqual([4]);
  });
});

describe("linkedTableViolations — tables that share totals", () => {
  const base = {
    rowLabels: ["a", "b"],
    colLabels: ["q1", "q2"],
    cells: [
      [20, 30],
      [40, 50],
    ],
    rowTotals: [50, 90],
    colTotals: [60, 80],
    grandTotal: 140,
    suppressionThreshold: 11,
  };

  it("accepts tables whose shared totals match", () => {
    expect(linkedTableViolations([{ name: "A", table: base }, { name: "B", table: structuredClone(base) }])).toEqual([]);
  });

  it("flags a shared total that differs, or is hidden in one table but shown in another", () => {
    const differs = { ...structuredClone(base), rowTotals: [50, 95] };
    expect(linkedTableViolations([{ name: "A", table: base }, { name: "B", table: differs }])).toEqual(['row total "b" differs between A and B']);
    const hiddenInOne = { ...structuredClone(base), grandTotal: null };
    expect(linkedTableViolations([{ name: "A", table: base }, { name: "B", table: hiddenInOne }])).toEqual(["the grand total differs between A and B"]);
  });

  it("flags tables that don't share the same rows", () => {
    const other = { ...structuredClone(base), rowLabels: ["a", "c"] };
    expect(linkedTableViolations([{ name: "A", table: base }, { name: "B", table: other }])).toEqual(["B does not have the same rows as A"]);
  });

  it("flags a hidden value the tables' equations recover exactly, naming it but not its value", () => {
    // Cell (a, q1), row total a and column total q1 hidden: the totals row gives the column total,
    // the q1 column then gives the cell, and row a gives its total.
    const leaky = { ...structuredClone(base), cells: [[null, 30], [40, 50]], rowTotals: [null, 90], colTotals: [null, 80] };
    const violations = linkedTableViolations([
      { name: "A", table: leaky },
      { name: "B", table: { ...structuredClone(base), rowTotals: [null, 90] } },
    ]);
    expect(violations.some((v) => v.startsWith("A cell (a, q1) is suppressed but can be recovered exactly"))).toBe(true);
    expect(violations.some((v) => v.startsWith('row total "a"'))).toBe(true);
    expect(violations.join(" ")).not.toMatch(/\b(20|50|60)\b/);
  });
});

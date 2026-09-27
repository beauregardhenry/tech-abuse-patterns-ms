// The disclosure rules, in one place. pipeline/suppress.ts applies them, and pipeline/audit.ts and
// dashboard/validate.ts check published tables against them, so the three can never disagree about
// what "safe" means. Everything here works on published values only, the same as a viewer would.
// Nothing in shared/ may import schema/, generator/ or pipeline/: the dashboard compiles this file
// too, and it must have no code path to record-level data.
//
// A 2-way table is treated as an (R+1) x (C+1) "augmented" matrix whose last row and column are the
// totals and whose bottom-right corner is the grand total. Every row and every column of that matrix
// (the totals row and totals column included) is a line: its parts sum to its total. A viewer can add
// and subtract any combination of those lines. Combining the lines in a set S cancels every value
// whose row and column are both in S, and leaves an equation over the values that cross S (row in S
// and column not, or the reverse). So for every set of lines, the hidden values crossing it must not
// give anything away:
//
//   - exactly one hidden value crossing S is recoverable outright, whatever its size;
//   - when every hidden value crossing S enters the equation with the same sign, the equation gives
//     their exact combined size. That derived number is itself a count, so it must meet the threshold
//     every displayed count meets (at least k), and it must exceed the number of hidden values,
//     since zeros are never hidden: a sum equal to that number pins every one of them to exactly 1.
//
// A single line is the smallest such set. Checking only single lines misses values that one line
// can't recover but a combination can, e.g. a hidden cell that is the only link between two groups
// of hidden cells. Every combination within a table is checked here: a table has at most a few
// dozen lines, and only lines touching a hidden value matter, so the search stays small.
//
// Violation messages name where and which rule, never a value: they reach logs and the page.

export const DEFAULT_SUPPRESSION_THRESHOLD = 11;

export function isValidThreshold(k: unknown): k is number {
  return typeof k === "number" && Number.isInteger(k) && k >= 2;
}

/** A threshold below 2 (or NaN, or a fraction) suppresses nothing; refuse it rather than fail open. */
export function assertValidThreshold(k: number): void {
  if (!isValidThreshold(k)) {
    throw new Error(`suppression threshold k must be an integer >= 2 (got ${k}); refusing to run with suppression disabled`);
  }
}

/** A coordinate of the augmented matrix: [R][*] is the totals row, [*][C] the totals column. */
export type Coord = readonly [number, number];

/** The values a viewer sees in one augmented matrix, and the labels to report problems with. */
export interface Grid {
  rowLabels: readonly string[];
  colLabels: readonly string[];
  /** The published value at a coordinate, or null if it is suppressed. */
  at: (coord: Coord) => number | null;
}

/** A published 2-way table. Both pipeline/types.ts and dashboard/types.ts match this shape. */
export interface PublishedTable {
  rowLabels: readonly string[];
  colLabels: readonly string[];
  cells: readonly (readonly (number | null)[])[];
  rowTotals: readonly (number | null)[];
  colTotals: readonly (number | null)[];
  grandTotal: number | null;
  suppressionThreshold: number;
}

export function gridOf(table: PublishedTable): Grid {
  const R = table.rowLabels.length;
  const C = table.colLabels.length;
  return {
    rowLabels: table.rowLabels,
    colLabels: table.colLabels,
    at: ([i, j]) => {
      if (i < R && j < C) return table.cells[i]![j]!;
      if (i < R) return table.rowTotals[i]!;
      if (j < C) return table.colTotals[j]!;
      return table.grandTotal;
    },
  };
}

/** A set of lines whose combination gives something away. */
export interface Disclosure {
  message: string;
  /** The hidden values the combination exposes. */
  hidden: Coord[];
  /** Shown non-zero values crossing the set. Hiding any one of them makes this set safe. */
  crossingShown: Coord[];
}

// Lines are numbered 0..R for the rows (R = totals row), then R+1..R+1+C for the columns
// (R+1+C = totals column). The value at [i][j] sits on line i and line R+1+j.
interface Layout {
  R: number;
  C: number;
  lineCount: number;
  lineLabel: (line: number) => string;
  /** The values on each line, in order: a row's cells then its total, or a column's. */
  cells: Coord[][];
}

function layoutOf(grid: Grid): Layout {
  const R = grid.rowLabels.length;
  const C = grid.colLabels.length;
  const lineLabel = (line: number) => {
    if (line < R) return `row "${grid.rowLabels[line]}"`;
    if (line === R) return "the column totals";
    const j = line - R - 1;
    return j < C ? `column "${grid.colLabels[j]}"` : "the row totals";
  };
  const cells = Array.from({ length: R + C + 2 }, (_, line): Coord[] => {
    if (line <= R) return Array.from({ length: C + 1 }, (_, j) => [line, j] as const);
    const j = line - R - 1;
    return Array.from({ length: R + 1 }, (_, i) => [i, j] as const);
  });
  return { R, C, lineCount: R + C + 2, lineLabel, cells };
}

/**
 * The sign a value takes in the combined equation of a set of lines, when its row line is in the
 * set. It is the opposite when its column line is in the set instead. Cells and the grand total
 * take +1, row and column totals -1: that is the weighting under which every value inside the set
 * cancels (each line's parts minus its total is zero).
 */
function rowSideSign([i, j]: Coord, layout: Layout): 1 | -1 {
  return i === layout.R !== (j === layout.C) ? -1 : 1;
}

function describe(lines: number[], layout: Layout): string {
  const labels = lines.map(layout.lineLabel);
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} combined`;
}

/**
 * What the combination of `lines` gives away, or null if nothing. `singleLine` adds the consistency
 * check a fully shown line needs (its values must actually add up).
 */
function checkCombination(lines: number[], inSet: Uint8Array, grid: Grid, layout: Layout, k: number, singleLine: boolean): Disclosure | null {
  const hidden: Coord[] = [];
  const hiddenSigns: number[] = [];
  const crossingShown: Coord[] = [];
  let shownSum = 0;
  for (const line of lines) {
    for (const coord of layout.cells[line]!) {
      const other = line <= layout.R ? layout.R + 1 + coord[1] : coord[0];
      if (inSet[other]) continue; // both lines in the set: cancels
      const sign = line <= layout.R ? rowSideSign(coord, layout) : -rowSideSign(coord, layout);
      const value = grid.at(coord);
      if (value === null) {
        hidden.push(coord);
        hiddenSigns.push(sign);
      } else {
        shownSum += sign * value;
        if (value > 0) crossingShown.push(coord);
      }
    }
  }

  const where = describe(lines, layout);
  if (hidden.length === 0) {
    return singleLine && shownSum !== 0 ? { message: `${where}: shown values do not add up to the shown total`, hidden, crossingShown } : null;
  }
  if (hidden.length === 1) {
    return { message: `${where}: exactly one suppressed value, recoverable by subtraction`, hidden, crossingShown };
  }
  const sameSign = hiddenSigns.every((s) => s === hiddenSigns[0]);
  if (!sameSign) return null;
  // sum(sign * hidden) + shownSum = 0, and every sign is the same, so the hidden values sum to:
  const derived = -hiddenSigns[0]! * shownSum;
  if (derived < k) {
    return { message: `${where}: suppressed values can be added up exactly, and their sum is below k=${k}`, hidden, crossingShown };
  }
  if (derived <= hidden.length) {
    return { message: `${where}: suppressed values add up to no more than their number, pinning each to exactly 1`, hidden, crossingShown };
  }
  return null;
}

/** Lines touching a hidden value, grouped into connected groups (lines linked by hidden values). */
function hiddenGroups(grid: Grid, layout: Layout): number[][] {
  const parent = Array.from({ length: layout.lineCount }, (_, v) => v);
  const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v]!)));
  const touched = new Set<number>();
  for (let i = 0; i <= layout.R; i++) {
    for (let j = 0; j <= layout.C; j++) {
      if (grid.at([i, j]) !== null) continue;
      const a = i;
      const b = layout.R + 1 + j;
      touched.add(a);
      touched.add(b);
      parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, number[]>();
  for (const v of [...touched].sort((x, y) => x - y)) {
    const root = find(v);
    groups.set(root, [...(groups.get(root) ?? []), v]);
  }
  return [...groups.values()];
}

// Non-empty proper subsets of n items as bitmasks over items 1..n-1 (item 0 always left out: a set
// and its complement give the same equation, negated), smallest subsets first.
const subsetCache = new Map<number, number[]>();
// The tables here have at most 14 lines. Past this many linked lines the exhaustive search would be
// too slow (and past 31, the bitmasks overflow), so refuse rather than check less than everything.
export const MAX_LINKED_LINES = 20;
function subsetsOf(n: number): number[] {
  if (n > MAX_LINKED_LINES) {
    throw new Error(`more than ${MAX_LINKED_LINES} lines are linked by hidden values; too many to check every combination, refusing`);
  }
  const cached = subsetCache.get(n);
  if (cached) return cached;
  const masks = Array.from({ length: (1 << (n - 1)) - 1 }, (_, m) => (m + 1) << 1);
  const bits = (m: number) => m.toString(2).replace(/0/g, "").length;
  masks.sort((a, b) => bits(a) - bits(b) || a - b);
  subsetCache.set(n, masks);
  return masks;
}

/**
 * Every set of lines whose combination gives something away. Single lines are checked first, in
 * order (rows, the column totals, columns, the row totals), then larger combinations, smallest
 * first. Stops after the first when `firstOnly` is set.
 */
export function findDisclosures(grid: Grid, k: number, firstOnly = false): Disclosure[] {
  const layout = layoutOf(grid);
  const inSet = new Uint8Array(layout.lineCount);
  const found: Disclosure[] = [];
  // One report per distinct set of exposed hidden values, however many combinations expose it.
  const seen = new Set<string>();
  const keep = (d: Disclosure | null): boolean => {
    if (!d) return false;
    const key = d.hidden.length === 0 ? `consistency ${d.message}` : d.hidden.map(([i, j]) => `${i},${j}`).sort().join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    found.push(d);
    return true;
  };
  for (let line = 0; line < layout.lineCount; line++) {
    inSet[line] = 1;
    const kept = keep(checkCombination([line], inSet, grid, layout, k, true));
    inSet[line] = 0;
    if (kept && firstOnly) return found;
  }
  for (const group of hiddenGroups(grid, layout)) {
    if (group.length < 3) continue; // two lines: each alone was already checked, and they're complements
    for (const mask of subsetsOf(group.length)) {
      const lines = group.filter((_, b) => (mask >> b) & 1);
      if (lines.length < 2 || group.length - lines.length < 2) continue; // a single line, or its complement
      for (const line of lines) inSet[line] = 1;
      const kept = keep(checkCombination(lines, inSet, grid, layout, k, false));
      for (const line of lines) inSet[line] = 0;
      if (kept && firstOnly) return found;
    }
  }
  return found;
}

/**
 * Every rule a published table must meet: a valid threshold, no shown value from 1 to k-1, and no
 * combination of lines that gives a hidden value away. Empty means compliant.
 */
export function tableViolations(table: PublishedTable): string[] {
  const k = table.suppressionThreshold;
  if (!isValidThreshold(k)) {
    return ["the suppression threshold is not an integer >= 2, so nothing is actually protected"];
  }
  const grid = gridOf(table);
  const R = table.rowLabels.length;
  const C = table.colLabels.length;
  const violations: string[] = [];
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= C; j++) {
      const v = grid.at([i, j]);
      if (v !== null && v > 0 && v < k) {
        const where =
          i < R && j < C ? `cell (${table.rowLabels[i]}, ${table.colLabels[j]})` : i < R ? `row total "${table.rowLabels[i]}"` : j < C ? `column total "${table.colLabels[j]}"` : "grand total";
        violations.push(`${where} is shown although it is below k=${k}`);
      }
    }
  }
  for (const d of findDisclosures(grid, k)) violations.push(d.message);
  return violations;
}

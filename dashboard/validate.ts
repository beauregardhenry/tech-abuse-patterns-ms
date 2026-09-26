import type { DashboardAggregates, LabelledOutput, SuppressedFlagCount, SuppressedStat, SuppressedTable } from "./types.js";

// The rendering layer's own check on the data file before anything is drawn (rule 5, defense in
// depth). The pipeline already refuses to emit unsafe output; this guards against a stale,
// hand-edited, or tampered file reaching the page. It checks the shape, the synthetic label and
// the threshold, and that no shown count is a small non-zero number. The full disclosure audit
// (derivable sums, shared totals) stays in pipeline/audit.ts — the dashboard can't import it.
//
// Every object is rebuilt from known fields only, so nothing unexpected in the file (an extra
// field, a record-shaped object) can reach the renderer.

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`rejected dashboard data: ${message}`);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function label(v: unknown, where: string): string {
  if (typeof v !== "string") fail(`${where} is not a label`);
  return v;
}

function labels(v: unknown, where: string): string[] {
  if (!Array.isArray(v)) fail(`${where} is not a list of labels`);
  return v.map((item, i) => label(item, `${where}[${i}]`));
}

function count(v: unknown, k: number, where: string): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`${where} is not a non-negative integer or null`);
  if (v > 0 && v < k) fail(`${where} shows ${v}, below k=${k}`);
  return v;
}

function counts(v: unknown, length: number, k: number, where: string): (number | null)[] {
  if (!Array.isArray(v) || v.length !== length) fail(`${where} does not have ${length} entries`);
  return v.map((item, i) => count(item, k, `${where}[${i}]`));
}

function table(v: unknown, k: number, where: string): SuppressedTable {
  if (!isObj(v)) fail(`${where} is not an object`);
  if (v.suppressionThreshold !== k) fail(`${where} uses a different threshold than the payload`);
  const rowLabels = labels(v.rowLabels, `${where}.rowLabels`);
  const colLabels = labels(v.colLabels, `${where}.colLabels`);
  if (!Array.isArray(v.cells) || v.cells.length !== rowLabels.length) fail(`${where}.cells does not have one row per label`);
  return {
    rowDimension: label(v.rowDimension, `${where}.rowDimension`),
    colDimension: label(v.colDimension, `${where}.colDimension`),
    rowLabels,
    colLabels,
    cells: v.cells.map((row, i) => counts(row, colLabels.length, k, `${where}.cells[${i}]`)),
    rowTotals: counts(v.rowTotals, rowLabels.length, k, `${where}.rowTotals`),
    colTotals: counts(v.colTotals, colLabels.length, k, `${where}.colTotals`),
    grandTotal: count(v.grandTotal, k, `${where}.grandTotal`),
    suppressionThreshold: k,
  };
}

function flagCounts(v: unknown, k: number): SuppressedFlagCount[] {
  if (!Array.isArray(v)) fail("outcomeCounts is not a list");
  return v.map((item, i) => {
    if (!isObj(item)) fail(`outcomeCounts[${i}] is not an object`);
    return { label: label(item.label, `outcomeCounts[${i}].label`), count: count(item.count, k, `outcomeCounts[${i}].count`) };
  });
}

function stats(v: unknown, k: number): SuppressedStat[] {
  if (!Array.isArray(v)) fail("daysToSafetyPlanByQuarter is not a list");
  return v.map((item, i) => {
    const where = `daysToSafetyPlanByQuarter[${i}]`;
    if (!isObj(item)) fail(`${where} is not an object`);
    const n = count(item.n, k, `${where}.n`);
    const median = item.medianDays;
    if (median !== null && (typeof median !== "number" || !Number.isFinite(median) || median < 0)) {
      fail(`${where}.medianDays is not a non-negative number or null`);
    }
    if ((n === null || n === 0) && median !== null) fail(`${where} shows a median without a publishable sample size`);
    return { label: label(item.label, `${where}.label`), n, medianDays: median };
  });
}

export function validatePayload(payload: unknown): LabelledOutput<DashboardAggregates> {
  if (!isObj(payload)) fail("payload is not an object");
  if (payload.synthetic !== true) fail("payload is not labelled synthetic");
  if (typeof payload.dataAsOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.dataAsOf)) {
    fail("dataAsOf is not a day-level YYYY-MM-DD date");
  }
  const data = payload.data;
  if (!isObj(data)) fail("data is not an object");
  const k = data.suppressionThreshold;
  if (typeof k !== "number" || !Number.isInteger(k) || k < 2) fail("suppressionThreshold is not an integer >= 2");

  return {
    synthetic: true,
    dataAsOf: payload.dataAsOf,
    data: {
      abuseTypeByQuarter: table(data.abuseTypeByQuarter, k, "abuseTypeByQuarter"),
      abuseTypeByRegion: table(data.abuseTypeByRegion, k, "abuseTypeByRegion"),
      abuseTypeTotals: table(data.abuseTypeTotals, k, "abuseTypeTotals"),
      outcomeCounts: flagCounts(data.outcomeCounts, k),
      daysToSafetyPlanByQuarter: stats(data.daysToSafetyPlanByQuarter, k),
      suppressionThreshold: k,
    },
  };
}

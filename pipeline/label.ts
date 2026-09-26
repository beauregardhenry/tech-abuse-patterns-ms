import type { LabelledOutput } from "./types.js";

export const SYNTHETIC_BANNER_TEXT = "SYNTHETIC DATA — for demonstration only, not real survivor data";

/**
 * Wraps data with the synthetic label and a coarse (day-level) "as of" date.
 * Rule 4 forbids showing near-real-time numbers — this intentionally drops
 * to day granularity and never carries a live/current timestamp, so the
 * dashboard cannot be read as "this just happened."
 */
export function labelSynthetic<T>(data: T, dataAsOf: Date = new Date()): LabelledOutput<T> {
  return {
    synthetic: true,
    dataAsOf: dataAsOf.toISOString().slice(0, 10),
    data,
  };
}

/** Every export's filename must carry the synthetic label (spec requirement), not just its contents. */
export function syntheticFileName(base: string, extension: string): string {
  return `${base}.SYNTHETIC.${extension}`;
}

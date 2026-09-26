import { ABUSE_TYPES, REGIONS, type AbuseType, type IntakeRecord, type Region } from "../schema/index.js";

// Hand-built (non-random) fixtures with exact, known counts per cell, used
// to exercise the privacy-critical edge cases the spec calls out explicitly:
// sparse regions, a cell just under the suppression threshold k, and a
// table where a displayed total would let a hidden cell be back-calculated.
// These are deliberately exact — the random generator can't guarantee a
// specific cell lands at exactly k-1.

function buildRecords(count: number, abuse_type: AbuseType, region: Region, quarter: string): IntakeRecord[] {
  return Array.from({ length: count }, () => ({
    abuse_type,
    finding_detail: "unknown_or_undetermined" as const,
    platform: "android" as const,
    region,
    quarter,
    outcome: [],
    days_to_safety_plan: null,
  }));
}

/**
 * Two abuse types across two regions, one of which is sparse: Region B
 * gets far fewer records than Region A, and one abuse_type/region
 * combination in Region B is empty (a true zero, not a suppressed count).
 */
export function sparseRegionFixture(quarter = "2025-Q1"): IntakeRecord[] {
  return [
    ...buildRecords(40, "spyware", "Region A", quarter),
    ...buildRecords(30, "tracker", "Region A", quarter),
    ...buildRecords(3, "spyware", "Region B", quarter),
    // No "tracker" records at all in Region B: a genuine zero.
  ];
}

/**
 * Deterministic but varied filler count for every (abuse_type, region)
 * cell, comfortably above any realistic k. Varied on purpose: identical
 * filler values across a whole grid create artificial ties during
 * secondary suppression (every "smallest visible cell" candidate is equally
 * small), which chains into suppressing far more of the table than a
 * realistic, naturally-varied dataset ever would. This is not a privacy
 * problem — over-suppression is always the safe direction — but it makes
 * a hand-built fixture behave nothing like real data.
 */
function fillerCount(abuseTypeIndex: number, regionIndex: number): number {
  return 40 + ((abuseTypeIndex * 11 + regionIndex * 5) % 30);
}

function fullGridWithOneLowCell(
  lowCount: number,
  targetAbuseType: AbuseType,
  targetRegion: Region,
  quarter: string,
): IntakeRecord[] {
  const records: IntakeRecord[] = [];
  ABUSE_TYPES.forEach((abuseType, abuseTypeIndex) => {
    REGIONS.forEach((region, regionIndex) => {
      const isTarget = abuseType === targetAbuseType && region === targetRegion;
      const count = isTarget ? lowCount : fillerCount(abuseTypeIndex, regionIndex);
      records.push(...buildRecords(count, abuseType, region, quarter));
    });
  });
  return records;
}

/**
 * A full abuse_type x region grid where every cell is well above k except
 * one, which falls exactly one record short of it.
 */
export function justUnderKFixture(k = 11, quarter = "2025-Q2"): IntakeRecord[] {
  return fullGridWithOneLowCell(k - 1, "spyware", "Region A", quarter);
}

/**
 * A full abuse_type x region grid with one cell below k while every row
 * total, column total, and the grand total clears k and would be
 * displayed. Naive primary-only suppression would let that one hidden cell
 * be recovered by subtracting the other (visible) cells in its row, column,
 * or the grand total. Complementary suppression must hide more than that.
 */
export function backCalculableTotalFixture(k = 11, quarter = "2025-Q3"): IntakeRecord[] {
  return fullGridWithOneLowCell(k - 2, "spyware", "Region A", quarter);
}

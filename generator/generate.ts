import {
  ABUSE_TYPES,
  MAX_DAYS_TO_SAFETY_PLAN,
  OUTCOMES,
  PLATFORMS,
  REGIONS,
  type AbuseType,
  type FindingDetail,
  type IntakeRecord,
  type Outcome,
  type Platform,
  type Region,
} from "../schema/index.js";
import { Rng } from "./rng.js";

// Distributions below are illustrative scaffolding only. They are not
// calibrated to any real statistic and must never be presented as such
// (see docs/PRIVACY.md and the spec's synthetic-data requirements).

const ABUSE_TYPE_FINDING_DETAILS: Record<AbuseType, readonly FindingDetail[]> = {
  spyware: ["stalkerware_app_generic", "dual_use_family_locator", "spouseware_known_family", "unknown_or_undetermined"],
  shared_account: ["shared_streaming_account", "shared_cloud_account"],
  tracker: ["gps_tracker_tag", "gps_tracker_dedicated_device"],
  smart_home: ["smart_speaker", "smart_lock_or_camera"],
  impersonation: ["impersonation_social_profile", "impersonation_account_takeover"],
  image_based: ["image_based_nonconsensual_sharing"],
};

const ABUSE_TYPE_PLATFORMS: Record<AbuseType, readonly Platform[]> = {
  spyware: ["android", "ios"],
  shared_account: ["android", "ios", "named_app_other"],
  tracker: ["vehicle_system", "android", "ios"],
  smart_home: ["smart_home_hub"],
  impersonation: ["named_app_other"],
  image_based: ["named_app_other"],
};

export interface AbuseTypeTrend {
  abuse_type: AbuseType;
  /** Relative weight at the first quarter in the run. */
  startWeight: number;
  /** Relative weight at the last quarter in the run; linearly interpolated in between. */
  endWeight: number;
}

export interface GenerateConfig {
  seed: number;
  quarters: readonly string[];
  totalRecords: number;
  /** Relative weight per region; regions omitted default to weight 1. */
  regionWeights?: Partial<Record<Region, number>>;
  /** Relative weight per abuse_type over time; abuse types omitted default to a flat weight of 1. */
  abuseTypeTrends?: readonly AbuseTypeTrend[];
  /** Independent probability each outcome flag is present on a record. */
  outcomeRates?: Partial<Record<Outcome, number>>;
  /** Mean days to safety plan (when a safety plan outcome exists) and the chance the field is null. */
  daysToSafetyPlan?: { meanDays: number; missingRate: number };
}

const DEFAULT_OUTCOME_RATES: Record<Outcome, number> = {
  safety_plan: 0.4,
  evidence_preserved: 0.3,
  protective_order_filed: 0.1,
};

function abuseTypeWeightAt(trend: AbuseTypeTrend, quarterIndex: number, quarterCount: number): number {
  if (quarterCount <= 1) return trend.startWeight;
  const t = quarterIndex / (quarterCount - 1);
  return trend.startWeight + (trend.endWeight - trend.startWeight) * t;
}

function weightsForQuarter(
  trends: readonly AbuseTypeTrend[] | undefined,
  quarterIndex: number,
  quarterCount: number,
): { types: AbuseType[]; weights: number[] } {
  const byType = new Map<AbuseType, number>(ABUSE_TYPES.map((t) => [t, 1]));
  for (const trend of trends ?? []) {
    byType.set(trend.abuse_type, abuseTypeWeightAt(trend, quarterIndex, quarterCount));
  }
  return { types: [...byType.keys()], weights: [...byType.values()] };
}

export function generateIntakeRecords(config: GenerateConfig): IntakeRecord[] {
  const rng = new Rng(config.seed);
  const regionEntries = REGIONS.map((r) => [r, config.regionWeights?.[r] ?? 1] as const);
  const regionNames = regionEntries.map(([r]) => r);
  const regionWeights = regionEntries.map(([, w]) => w);
  const outcomeRates = { ...DEFAULT_OUTCOME_RATES, ...config.outcomeRates };
  const daysToSafetyPlan = config.daysToSafetyPlan ?? { meanDays: 5, missingRate: 0.5 };

  const records: IntakeRecord[] = [];
  for (let i = 0; i < config.totalRecords; i++) {
    const quarterIndex = rng.nextInt(config.quarters.length);
    const quarter = config.quarters[quarterIndex]!;
    const { types, weights } = weightsForQuarter(config.abuseTypeTrends, quarterIndex, config.quarters.length);
    const abuse_type = rng.weightedPick(types, weights);
    const region = rng.weightedPick(regionNames, regionWeights);
    const finding_detail = rng.pick(ABUSE_TYPE_FINDING_DETAILS[abuse_type]);
    const platform = rng.pick(ABUSE_TYPE_PLATFORMS[abuse_type] ?? PLATFORMS);

    const outcome = OUTCOMES.filter((o) => rng.chance(outcomeRates[o] ?? 0));

    const hasSafetyPlan = outcome.includes("safety_plan");
    const days_to_safety_plan =
      hasSafetyPlan && !rng.chance(daysToSafetyPlan.missingRate)
        ? Math.min(
            MAX_DAYS_TO_SAFETY_PLAN,
            Math.max(0, Math.round(daysToSafetyPlan.meanDays + (rng.next() - 0.5) * daysToSafetyPlan.meanDays * 2)),
          )
        : null;

    records.push({
      abuse_type,
      finding_detail,
      platform,
      region,
      quarter,
      outcome,
      days_to_safety_plan,
    });
  }

  return records;
}

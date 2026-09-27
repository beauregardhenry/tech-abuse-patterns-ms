import { z } from "zod";

// Fixed, closed vocabularies. Nothing here may be replaced with a free-text
// field: free text is how identifying detail leaks into aggregate data.
// The finding_detail/platform lists are placeholders pending the final list
// from ISDi/Sherloc output and advocate input (see docs/DECISIONS.md).

export const ABUSE_TYPES = [
  "spyware",
  "shared_account",
  "tracker",
  "smart_home",
  "impersonation",
  "image_based",
] as const;

export const FINDING_DETAILS = [
  "stalkerware_app_generic",
  "dual_use_family_locator",
  "spouseware_known_family",
  "gps_tracker_tag",
  "gps_tracker_dedicated_device",
  "shared_streaming_account",
  "shared_cloud_account",
  "smart_speaker",
  "smart_lock_or_camera",
  "impersonation_social_profile",
  "impersonation_account_takeover",
  "image_based_nonconsensual_sharing",
  "unknown_or_undetermined",
] as const;

export const PLATFORMS = [
  "ios",
  "android",
  "vehicle_system",
  "smart_home_hub",
  "named_app_other",
] as const;

// Placeholders. Real multi-county regions must be defined with the
// coalition; never county-level (see docs/DECISIONS.md).
export const REGIONS = ["Region A", "Region B", "Region C", "Region D", "Region E", "Region F"] as const;

export const OUTCOMES = ["safety_plan", "evidence_preserved", "protective_order_filed"] as const;

export const QUARTER_PATTERN = /^\d{4}-Q[1-4]$/;

// Upper bound on days_to_safety_plan. A placeholder pending partner input (see
// docs/DECISIONS.md): it rejects garbage like 100000 at intake, so a single malformed record can't
// sit at the extreme of a published statistic.
export const MAX_DAYS_TO_SAFETY_PLAN = 365;

export const IntakeRecordSchema = z
  .object({
    abuse_type: z.enum(ABUSE_TYPES),
    finding_detail: z.enum(FINDING_DETAILS),
    platform: z.enum(PLATFORMS),
    region: z.enum(REGIONS),
    quarter: z.string().regex(QUARTER_PATTERN, "quarter must be formatted YYYY-Qn"),
    outcome: z
      .array(z.enum(OUTCOMES))
      .max(OUTCOMES.length)
      .refine((outcomes) => new Set(outcomes).size === outcomes.length, "outcome must not repeat a value"),
    days_to_safety_plan: z.number().int().nonnegative().max(MAX_DAYS_TO_SAFETY_PLAN).nullable(),
  })
  .strict()
  .refine((r) => r.days_to_safety_plan === null || r.outcome.includes("safety_plan"), {
    message: "days_to_safety_plan requires a safety_plan outcome",
    path: ["days_to_safety_plan"],
  });

export type IntakeRecord = z.infer<typeof IntakeRecordSchema>;
export type AbuseType = (typeof ABUSE_TYPES)[number];
export type FindingDetail = (typeof FINDING_DETAILS)[number];
export type Platform = (typeof PLATFORMS)[number];
export type Region = (typeof REGIONS)[number];
export type Outcome = (typeof OUTCOMES)[number];

export function parseIntakeRecord(candidate: unknown): IntakeRecord {
  return IntakeRecordSchema.parse(candidate);
}

export function isIntakeRecord(candidate: unknown): candidate is IntakeRecord {
  return IntakeRecordSchema.safeParse(candidate).success;
}

import type { GenerateConfig } from "../generator/index.js";

// The synthetic dataset the dashboard and the partner demo show. One definition, so the demo can't
// drift from the dashboard. Like every generator setting, these distributions are arbitrary and
// must never be presented as realistic (see docs/PRIVACY.md).
export const QUARTERS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];
export const SEED = 20250926;
export const SUPPRESSION_THRESHOLD = 11;

export function syntheticDatasetConfig(totalRecords: number): GenerateConfig {
  return {
    seed: SEED,
    quarters: QUARTERS,
    totalRecords,
    abuseTypeTrends: [
      { abuse_type: "spyware", startWeight: 1, endWeight: 2.5 },
      { abuse_type: "tracker", startWeight: 0.5, endWeight: 1.6 },
    ],
    regionWeights: {
      "Region A": 3,
      "Region B": 2.5,
      "Region C": 1,
      "Region D": 0.4,
      "Region E": 0.2,
      "Region F": 1.5,
    },
  };
}

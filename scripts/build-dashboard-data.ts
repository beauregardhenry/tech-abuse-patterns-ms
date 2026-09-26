import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIntakeRecords } from "../generator/index.js";
import { runPipeline } from "../pipeline/index.js";
import { syntheticFileName } from "../pipeline/label.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const QUARTERS = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"];
const SEED = 20250926;
const TOTAL_RECORDS = 5000;
const SUPPRESSION_THRESHOLD = 11;

function main() {
  const records = generateIntakeRecords({
    seed: SEED,
    quarters: QUARTERS,
    totalRecords: TOTAL_RECORDS,
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
  });

  const output = runPipeline(records, QUARTERS, SUPPRESSION_THRESHOLD);

  const fileName = syntheticFileName("aggregates", "json");
  const outDir = join(__dirname, "..", "dashboard", "data");
  const outPath = join(outDir, fileName);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} (${TOTAL_RECORDS} synthetic records, seed ${SEED}, k=${SUPPRESSION_THRESHOLD})`);
}

main();

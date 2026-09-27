import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIntakeRecords } from "../generator/index.js";
import { runPipeline } from "../pipeline/index.js";
import { syntheticFileName } from "../pipeline/label.js";
import { QUARTERS, SEED, SUPPRESSION_THRESHOLD, syntheticDatasetConfig } from "./synthetic-dataset.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOTAL_RECORDS = 5000;

function main() {
  const records = generateIntakeRecords(syntheticDatasetConfig(TOTAL_RECORDS));
  const output = runPipeline(records, QUARTERS, SUPPRESSION_THRESHOLD);

  const fileName = syntheticFileName("aggregates", "json");
  const outDir = join(__dirname, "..", "dashboard", "data");
  const outPath = join(outDir, fileName);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath} (${TOTAL_RECORDS} synthetic records, seed ${SEED}, k=${SUPPRESSION_THRESHOLD})`);
}

main();

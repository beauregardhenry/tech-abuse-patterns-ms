// Builds the partner demo (demo/template.html) into demo/dist/: the page with two synthetic
// datasets embedded, plus the dashboard's own compiled render and check modules, which the page
// imports. Run through `npm run build:demo`, which compiles the dashboard first. Publish
// demo/dist/tech-abuse-demo.html as a private claude.ai page with its js/ files alongside
// (see README, "Partner demo").

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIntakeRecords } from "../generator/index.js";
import { runPipeline } from "../pipeline/index.js";
import { validatePayload } from "../dashboard/validate.js";
import { QUARTERS, SUPPRESSION_THRESHOLD, syntheticDatasetConfig } from "./synthetic-dataset.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILED = join(ROOT, "dashboard", "js");
const OUT = join(ROOT, "demo", "dist");

// Each dataset's placeholder in the template, and its size. The smaller one shows suppression.
const DATASETS = [
  { placeholder: ">{{LARGER}}<", totalRecords: 5000 },
  { placeholder: ">{{SMALLER}}<", totalRecords: 250 },
];

// The modules the page imports, and theirs. main.js is the dashboard's own entry point; the demo
// has its own, inline.
const MODULES = ["dashboard/render.js", "dashboard/validate.js", "shared/disclosure.js", "shared/linked.js"];

function main() {
  if (!existsSync(join(COMPILED, "dashboard", "render.js"))) {
    throw new Error("dashboard/js/ is missing; run `npm run build:demo`, which compiles the dashboard first");
  }
  let page = readFileSync(join(ROOT, "demo", "template.html"), "utf8");
  for (const { placeholder, totalRecords } of DATASETS) {
    if (!page.includes(placeholder)) throw new Error(`demo/template.html has no ${placeholder} placeholder`);
    const payload = runPipeline(generateIntakeRecords(syntheticDatasetConfig(totalRecords)), QUARTERS, SUPPRESSION_THRESHOLD);
    // The page runs the same check before drawing; failing here keeps a bad build from being published.
    validatePayload(JSON.parse(JSON.stringify(payload)));
    page = page.replace(placeholder, `>${JSON.stringify(payload).replaceAll("</", "<\\/")}<`);
  }

  rmSync(OUT, { recursive: true, force: true });
  for (const module of MODULES) {
    const target = join(OUT, "js", module);
    mkdirSync(dirname(target), { recursive: true });
    const source = readFileSync(join(COMPILED, module), "utf8");
    writeFileSync(target, source.replace(/^\/\/# sourceMappingURL=.*$/m, "").trimEnd() + "\n");
  }
  writeFileSync(join(OUT, "tech-abuse-demo.html"), page);

  const files = readdirSync(join(OUT, "js"), { recursive: true }).filter((f) => String(f).endsWith(".js"));
  console.log(`Built demo/dist/tech-abuse-demo.html with ${DATASETS.length} synthetic datasets and ${files.length} modules.`);
  console.log("Publish tech-abuse-demo.html as a claude.ai page with the js/ folder alongside it, at the same paths.");
}

main();

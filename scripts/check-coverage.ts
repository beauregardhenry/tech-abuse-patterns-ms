#!/usr/bin/env -S npx tsx
// Test coverage only ratchets one way. This measures line coverage over
// schema/, generator/, pipeline/, shared/, and dashboard/validate.ts (see
// vitest.config.ts's `include`) and fails when it slips below the number
// recorded in coverage-baseline.txt, so a change that adds untested code has
// to say so out loud instead of quietly diluting the suite.
//
// The rest of dashboard/ is excluded on purpose (see vitest.config.ts): it's
// browser UI verified by rendering it in a headless browser, not by this
// suite, and counting it here would swamp the real signal with code this
// suite structurally cannot reach. scripts/ is build tooling, excluded the
// same way.
//
// Unlike Kistulentz's per-architecture floors (Swift coverage instrumentation
// differs between Apple silicon and Intel), Node coverage via v8 is
// deterministic across platforms, so this uses a single baseline number.
//
// Do NOT bump coverage-baseline.txt from a feature branch. A
// .github/workflows/coverage-ratchet.yml job re-measures on every push to
// main and commits the raised number itself, so two PRs in flight at once
// never both edit the same line and conflict with each other on merge. A
// feature branch only needs the plain (no-flag) form below to pass; leave
// the file alone.
//
//   npx tsx scripts/check-coverage.ts                 measure and enforce the baseline (what a PR runs)
//   npx tsx scripts/check-coverage.ts --update-if-higher
//       measure and raise the baseline only if it climbed past the ratchet slack; never lowers it.
//       This is what the post-merge workflow runs on main -- not meant for a feature branch.
//   npx tsx scripts/check-coverage.ts --update         measure and unconditionally rewrite the baseline.
//       For deliberately lowering it (with a reason in the commit) or fixing up the file by hand;
//       not the normal way coverage climbs.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = join(PROJECT_ROOT, "coverage-baseline.txt");

// How far coverage may drift below the baseline before the build fails. Small enough to catch a
// deleted test, loose enough to absorb rounding when unrelated files move around.
const TOLERANCE = Number(process.env.COVERAGE_TOLERANCE ?? "0.25");
// How far above the baseline coverage has to climb before we nag about raising it.
const RATCHET_SLACK = Number(process.env.COVERAGE_RATCHET_SLACK ?? "0.5");

type Mode = "check" | "update" | "update-if-higher";

function parseMode(argv: string[]): Mode {
  const arg = argv[2];
  if (!arg) return "check";
  if (arg === "--update") return "update";
  if (arg === "--update-if-higher") return "update-if-higher";
  console.error(`Usage: check-coverage.ts [--update|--update-if-higher]`);
  process.exit(2);
}

function readBaseline(): number | null {
  if (!existsSync(BASELINE_FILE)) return null;
  const line = readFileSync(BASELINE_FILE, "utf8")
    .split("\n")
    .find((l) => l.trim() && !l.trim().startsWith("#"));
  if (!line) return null;
  const value = Number(line.trim());
  return Number.isFinite(value) ? value : null;
}

function writeBaseline(pct: number): void {
  writeFileSync(
    BASELINE_FILE,
    `# Line coverage floor for the scope in vitest.config.ts's coverage.include.\n` +
      `# Raised automatically by .github/workflows/coverage-ratchet.yml on every push to\n` +
      `# main; don't bump it from a feature branch (see the header of this script). Lower\n` +
      `# it only deliberately, with a reason in the commit.\n` +
      `${pct.toFixed(2)}\n`,
  );
}

function measureCoveragePct(): number {
  console.log("Running the test suite with a fresh coverage profile.");
  execFileSync("npx", ["vitest", "run", "--coverage", "--coverage.reporter=json-summary"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });

  const summaryPath = join(PROJECT_ROOT, "coverage", "coverage-summary.json");
  if (!existsSync(summaryPath)) {
    console.error(`Coverage check failed: ${summaryPath} was not produced.`);
    process.exit(1);
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const lines = summary.total?.lines;
  if (!lines || typeof lines.pct !== "number") {
    console.error("Coverage check failed: coverage-summary.json did not contain a total line percentage.");
    process.exit(1);
  }
  console.log(`\nLine coverage (vitest.config.ts scope): ${lines.pct}% (${lines.covered}/${lines.total} lines)`);
  return lines.pct;
}

function main(): void {
  const mode = parseMode(process.argv);
  const pct = measureCoveragePct();
  const baseline = readBaseline();

  if (mode === "update") {
    writeBaseline(pct);
    console.log(`Baseline updated to ${pct.toFixed(2)}%. Commit coverage-baseline.txt.`);
    return;
  }

  if (baseline === null) {
    if (mode === "update-if-higher") {
      writeBaseline(pct);
      console.log(`No baseline recorded yet; seeded it at ${pct.toFixed(2)}%.`);
      return;
    }
    console.log("\nNo coverage baseline recorded yet, so nothing to enforce.");
    console.log("This is normally seeded by the post-merge coverage-ratchet workflow, not by hand.");
    return;
  }

  const floor = Math.max(0, baseline - TOLERANCE);
  const verdict = pct < floor ? "below" : pct > baseline + RATCHET_SLACK ? "above" : "held";

  if (mode === "update-if-higher") {
    // Runs post-merge on main, never in a PR: only ever raises the floor, and a regression here
    // means something merged despite the PR-time check below failing or being skipped, so it's
    // surfaced loudly rather than silently lowering the bar.
    if (verdict === "below") {
      console.error(`\nCoverage check failed: ${pct}% is below the ${baseline}% baseline (floor ${floor.toFixed(2)}%) on main.`);
      console.error("The baseline was left untouched; investigate how a regression reached main.");
      process.exit(1);
    } else if (verdict === "above") {
      writeBaseline(pct);
      console.log(`\nBaseline raised from ${baseline}% to ${pct}%. Committing coverage-baseline.txt.`);
    } else {
      console.log(`\nCoverage holds at ${pct}% against the ${baseline}% baseline; nothing to update.`);
    }
    return;
  }

  if (verdict === "below") {
    console.error(`\nCoverage check failed: ${pct}% is below the ${baseline}% baseline (floor ${floor.toFixed(2)}%).`);
    console.error("Add tests for the new code, or lower coverage-baseline.txt deliberately and say why in the commit.");
    process.exit(1);
  } else if (verdict === "above") {
    console.log(`\nCoverage rose to ${pct}% from the ${baseline}% baseline.`);
    console.log("No action needed: the post-merge coverage-ratchet workflow will raise the baseline on main automatically.");
  } else {
    console.log(`\nCoverage holds at ${pct}% against the ${baseline}% baseline.`);
  }
}

main();

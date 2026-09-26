#!/usr/bin/env -S npx tsx
// Test count only ratchets one way, the same shape as check-coverage.ts: fails when the count of
// test cases in tests/ drops below the number recorded in test-count-baseline.txt. Coverage mostly
// catches a deleted test too (removing a test usually lowers the percentage), but a raw count is a
// more direct signal and harder to lose in the noise -- a test quietly commented out, `.skip`ped,
// or deleted during a merge conflict shows up here even when the coverage percentage barely moves.
//
// Counting is static: a grep over `it(`/`test(` call sites in tests/*.test.ts, not an actual test
// run. That keeps this check fast and dependency-free, and (like Kistulentz's grep over
// `func testFoo()`) naturally excludes `it.skip(`/`it.todo(`/`test.skip(` since those don't match
// a bare `it(`/`test(` — a skipped test correctly stops counting toward the floor.
//
// Unlike Kistulentz's separate Swift-suite/UI-suite counts, this project has one test suite, so
// this uses a single count rather than a per-suite split.
//
// Known limitation: a parameterized `it.each([...])(...)` call site is counted once even though it
// may run several cases — not used anywhere in this suite today, but if it is later, this check
// will undercount those cases specifically.
//
// Do NOT bump test-count-baseline.txt from a feature branch. A
// .github/workflows/test-count-ratchet.yml job re-measures on every push to main and commits the
// raised number itself, the same single-writer convention check-coverage.ts's baseline already
// uses.
//
//   npx tsx scripts/check-test-count.ts                 measure and enforce the baseline (what a PR runs)
//   npx tsx scripts/check-test-count.ts --update-if-higher
//       measure and raise the baseline only if the count climbed; never lowers it.
//       This is what the post-merge workflow runs on main -- not meant for a feature branch.
//   npx tsx scripts/check-test-count.ts --update         measure and unconditionally rewrite the baseline.
//       For deliberately lowering it (with a reason in the commit) or fixing up the file by hand;
//       not the normal way the test count climbs.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = join(PROJECT_ROOT, "test-count-baseline.txt");
const TESTS_DIR = join(PROJECT_ROOT, "tests");

type Mode = "check" | "update" | "update-if-higher";

function parseMode(argv: string[]): Mode {
  const arg = argv[2];
  if (!arg) return "check";
  if (arg === "--update") return "update";
  if (arg === "--update-if-higher") return "update-if-higher";
  console.error(`Usage: check-test-count.ts [--update|--update-if-higher]`);
  process.exit(2);
}

function countTests(): number {
  const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.ts"));
  let count = 0;
  for (const file of files) {
    const contents = readFileSync(join(TESTS_DIR, file), "utf8");
    const matches = contents.match(/\b(it|test)\(/g);
    count += matches?.length ?? 0;
  }
  return count;
}

function readBaseline(): number | null {
  if (!existsSync(BASELINE_FILE)) return null;
  const line = readFileSync(BASELINE_FILE, "utf8")
    .split("\n")
    .find((l) => l.trim() && !l.trim().startsWith("#"));
  if (!line) return null;
  const value = Number(line.trim());
  return Number.isInteger(value) ? value : null;
}

function writeBaseline(count: number): void {
  writeFileSync(
    BASELINE_FILE,
    `# Test-case-count floor for tests/*.test.ts. Raised automatically by\n` +
      `# .github/workflows/test-count-ratchet.yml on every push to main; don't bump it\n` +
      `# from a feature branch (see the header of scripts/check-test-count.ts). Lower it\n` +
      `# only deliberately, with a reason in the commit.\n` +
      `${count}\n`,
  );
}

function main(): void {
  const mode = parseMode(process.argv);
  const count = countTests();
  console.log(`Test count: ${count}`);

  if (mode === "update") {
    writeBaseline(count);
    console.log(`Baseline updated to ${count}. Commit test-count-baseline.txt.`);
    return;
  }

  const baseline = readBaseline();

  if (baseline === null) {
    if (mode === "update-if-higher") {
      writeBaseline(count);
      console.log(`No baseline recorded yet; seeded it at ${count}.`);
      return;
    }
    console.log("\nNo test-count baseline recorded yet, so nothing to enforce.");
    console.log("This is normally seeded by the post-merge test-count-ratchet workflow, not by hand.");
    return;
  }

  if (mode === "update-if-higher") {
    // Runs post-merge on main, never in a PR: a drop here means something merged despite the
    // PR-time check below failing or being skipped, so it's surfaced loudly rather than silently
    // lowering the floor.
    if (count < baseline) {
      console.error(`\nTest count check failed: count ${count} is below the ${baseline} baseline on main.`);
      console.error("The baseline was left untouched; investigate how a regression reached main.");
      process.exit(1);
    } else if (count > baseline) {
      writeBaseline(count);
      console.log(`\nTest count rose to ${count} from the ${baseline} baseline. Committing test-count-baseline.txt.`);
    } else {
      console.log(`\nTest count holds at ${count}; nothing to update.`);
    }
    return;
  }

  if (count < baseline) {
    console.error(`\nTest count check failed: count ${count} is below the ${baseline} baseline.`);
    console.error("A test was removed, renamed away from the it(/test( pattern, or commented out.");
    console.error("Add tests back, or lower test-count-baseline.txt deliberately and say why in the commit.");
    process.exit(1);
  } else if (count > baseline) {
    console.log(`\nTest count rose to ${count} from the ${baseline} baseline.`);
    console.log("No action needed: the post-merge test-count-ratchet workflow will raise the baseline on main automatically.");
  } else {
    console.log(`\nTest count holds at ${count} against the ${baseline} baseline.`);
  }
}

main();

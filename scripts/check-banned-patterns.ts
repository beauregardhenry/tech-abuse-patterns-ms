#!/usr/bin/env -S npx tsx
// Four patterns that should never appear in the app's source layers, all currently at zero. This
// ratchets structurally rather than numerically: the floor is just 0, forever, with no baseline
// file to manage the way coverage/test-count need -- there's no legitimate reason for any of
// these counts to ever rise above zero, so failing the moment one does is the whole design.
//
// Scoped to schema/, generator/, pipeline/, and dashboard/ -- the app's source layers -- not
// tests/ (assertions legitimately reference these strings) or scripts/ (build tooling, where
// console.log and process.exit are the normal way a CLI script reports progress and exit status).
//
// Translated from Kistulentz's check-banned-patterns.sh (Swift -> TypeScript):
//   as! (forced downcast)      -> as any (unsafe type assertion)
//   fatalError(                -> process.exit( (abrupt, uncatchable termination outside a script entry point)
//   print( (debug output)      -> console.log(
//   TODO/FIXME comment markers -> TODO/FIXME comment markers (unchanged)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = ["schema", "generator", "pipeline", "shared", "dashboard"];

interface Pattern {
  label: string;
  regex: RegExp;
}

const PATTERNS: Pattern[] = [
  { label: "as any (unsafe type assertion)", regex: /\bas any\b/ },
  { label: "process.exit( outside a script entry point", regex: /\bprocess\.exit\(/ },
  { label: "console.log( (debug output left in)", regex: /\bconsole\.log\(/ },
  { label: "TODO/FIXME comment markers", regex: /\/\/\s*(TODO|FIXME)/ },
];

function walkTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

function main(): void {
  const files = SOURCE_DIRS.flatMap((dir) => walkTsFiles(join(PROJECT_ROOT, dir)));

  const findings: string[] = [];
  for (const pattern of PATTERNS) {
    const matches: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (pattern.regex.test(line)) {
          matches.push(`  ${relative(PROJECT_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    if (matches.length > 0) {
      findings.push(pattern.label);
      console.error(`\nFound ${pattern.label}:`);
      for (const match of matches) console.error(match);
    }
  }

  if (findings.length > 0) {
    console.error(`\nBanned-pattern check failed: ${findings.length} pattern(s) found in ${SOURCE_DIRS.join("/, ")}/.`);
    console.error("Replace an unsafe cast or abrupt exit with a real error path, remove a leftover");
    console.error("debug console.log(), and either finish or file the TODO/FIXME as a tracked issue");
    console.error("before merging -- these patterns hold at zero on main.");
    process.exit(1);
  }

  console.log(`Banned-pattern check passed: no as any, process.exit(, console.log(, or TODO/FIXME in ${SOURCE_DIRS.join("/, ")}/.`);
}

main();

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The dashboard must have no code path to record-level data (docs/PRIVACY.md, rule 5). It compiles
// dashboard/ and shared/ only, so neither may import schema/, generator/ or pipeline/.
const root = join(import.meta.dirname, "..");

function importsOf(dir: string): { file: string; from: string }[] {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) =>
      [...readFileSync(join(root, dir, file), "utf8").matchAll(/(?:import|export)[^"']*from\s*["']([^"']+)["']/g)].map((m) => ({
        file: `${dir}/${file}`,
        from: m[1]!,
      })),
    );
}

describe("the dashboard's import boundary", () => {
  it("dashboard/ imports only dashboard/ and shared/", () => {
    const imports = importsOf("dashboard");
    expect(imports.length).toBeGreaterThan(0);
    for (const { file, from } of imports) {
      expect(from.startsWith("./") || from.startsWith("../shared/"), `${file} imports ${from}`).toBe(true);
    }
  });

  it("shared/ imports only shared/", () => {
    for (const { file, from } of importsOf("shared")) {
      expect(from.startsWith("./"), `${file} imports ${from}`).toBe(true);
    }
  });
});

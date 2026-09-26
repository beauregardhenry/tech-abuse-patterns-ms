import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Scoped to the unit-tested business logic only — the same reasoning
      // Kistulentz's check-coverage.sh uses to exclude Views/: dashboard/ is
      // browser UI verified visually (a headless-browser render), not by
      // this suite, and scripts/ is build tooling, not app logic. Including
      // either here would swamp the real signal from schema/generator/
      // pipeline with code this suite structurally cannot reach.
      include: ["schema/**", "generator/**", "pipeline/**"],
      exclude: ["**/*.d.ts", "**/index.ts"],
    },
  },
});

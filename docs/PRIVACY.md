# Privacy design

This document records how each privacy rule from the build spec is implemented, where the enforcement actually lives, and where the implementation has known limits. It should be read alongside `docs/DECISIONS.md`, which records what was rejected and what is still open.

**This is v0, synthetic data only.** Nothing here has been reviewed by a statistician or the partner organization. Do not point this pipeline at real survivor data until that review happens and the partner has signed off (see the spec's non-negotiables).

## The five rules and where they live

### 1. Hide small counts

Any aggregate cell with a raw value in `1..k-1` is suppressed (`pipeline/suppress.ts`). `k` defaults to 11 (`DEFAULT_SUPPRESSION_THRESHOLD` in `pipeline/suppress.ts`) and is a parameter on every function that needs it — nothing hardcodes 11 outside that one constant. **The default of 11 is a placeholder**, chosen because it matches a threshold used in some health-data programs (e.g. CMS), not because it has been validated for this context. The spec is explicit that the right threshold has to be confirmed with the partner organization — see `docs/DECISIONS.md`.

A **genuine zero is never suppressed.** A cell that is exactly 0 means no records exist for that combination — there is no individual's data to protect, so hiding it would only destroy the "where is there no support" signal the state coalition audience needs. This is a real design choice, not an oversight: see `pipeline/suppress.ts`'s `smallestUnsuppressedNonzero`, which explicitly skips zero-valued cells when picking a secondary-suppression target, and `generator/fixtures.ts`'s `sparseRegionFixture`, which exists specifically to test that a true zero renders as `0`, not as hidden.

### 2. Hide back-calculable counts

If a row total, column total, or the grand total is displayed alongside cells where exactly one cell is hidden, that hidden cell can be recovered by subtraction. `pipeline/suppress.ts` runs iterative complementary ("secondary") suppression after primary suppression: for every row, column, and the grand total, if exactly one constituent cell is hidden while the margin is shown, another cell (or, failing that, the margin itself) is also hidden. This repeats to a fixed point (capped at 50 iterations, which is far more than any table this pipeline builds should need).

`pipeline/audit.ts`'s `findSuppressionViolations` is the automated check for this: it scans a finished table for any row/column/grand-total margin with exactly one hidden cell and reports it as a violation. It is not just a test helper — `pipeline/index.ts`'s `runPipeline` calls it on every table it builds and **throws if any violation is found**, before the data is labelled or handed back to a caller.

**Known limitation.** This protects against recovering a hidden cell from *one* margin at a time (its row, its column, or the grand total) in a 2-way table. It is not a full linear-programming disclosure audit across every possible combination of margins in a higher-dimensional table — that is a substantially harder problem (this is why real statistical agencies use dedicated tools like τ-ARGUS for it). For v0's simple cross-tabs this heuristic is sound and is tested against deliberately adversarial fixtures (`generator/fixtures.ts`), but it should not be assumed to generalize to a more complex table shape without review.

A consequence worth calling out explicitly: for a small, sparse table (few rows/columns, most cells near the threshold), this algorithm can cascade to suppressing most or all of the table. That is the *safe* direction to fail in — over-suppression, never under-suppression — but it means utility degrades sharply on very small slices. `tests/suppression.test.ts` asserts this doesn't happen on a realistically-sized, realistically-varied table (see the "utility sanity check" in that file), but a dashboard view that lets someone slice down to a near-empty cross-section should expect to see a lot of `hidden` cells, by design.

**Independent (non-margin) counts are a separate, simpler case.** `pipeline/outcomes.ts` (outcome flags) and `pipeline/stats.ts` (days-to-safety-plan means) are not cross-tabs — they're independent counts/statistics with no combined total ever displayed alongside them. Because there's no margin to subtract from, complementary suppression doesn't apply; primary threshold suppression on each value independently is sufficient. **This assumption breaks if a future version adds a combined total next to these values** — if that happens, this needs the same margin-protection treatment as the cross-tabs, not the simpler one.

### 3. Coarsen before storing

The schema (`schema/intakeRecord.ts`) only accepts `region` (a closed enum, never county) and `quarter` (a `YYYY-Qn` string, never an exact date) — there is no field for exact location or a precise timestamp anywhere in `IntakeRecord`, so there's nothing more precise to coarsen at query time; precision loss happens at the point of intake, not as a downstream transformation. `IntakeRecordSchema` uses zod's `.strict()` mode, so no other field — free text, name, age, exact address — can be attached to a record at all; this is enforced by the type system and a parse-time rejection, not by a lint rule or a UI omission. `tests/schema.test.ts` tests this rejection directly, including cases like a name, an age, a county name in place of region, and an exact date in place of quarter.

### 4. Show the data's age

`pipeline/label.ts`'s `labelSynthetic` stamps every pipeline output with `dataAsOf`, truncated to day granularity (`toISOString().slice(0, 10)`) — there is no code path that attaches a live or current timestamp to displayed data. The dashboard (`dashboard/main.ts`) renders this directly as "Data last refreshed: …" and is explicit in the copy that the number is synthetic and not real-time. `tests/pipeline.test.ts` asserts the format is day-level (`/^\d{4}-\d{2}-\d{2}$/`), guarding against a future edit accidentally switching to a full timestamp.

### 5. Enforce it before display

Two independent layers back this up:

- **Runtime, in the pipeline.** As described under rule 2, `runPipeline` audits every table it produces and refuses to return anything that fails the audit. The dashboard never calls `suppressTable` directly — it only ever receives the already-audited output of `runPipeline`.
- **Structural, in the dashboard's own build.** `dashboard/types.ts` is a local, hand-maintained copy of the JSON contract the dashboard expects — it does not import from `pipeline/` at all. This means the dashboard's TypeScript project (`dashboard/tsconfig.json`) has no code path back into the schema, generator, or pipeline modules; it can only ever consume the flat, suppressed JSON produced by `scripts/build-dashboard-data.ts`. There is no `IntakeRecord` type reachable from anywhere in `dashboard/`. (Trade-off: `dashboard/types.ts` must be kept in sync by hand if `pipeline/index.ts`'s `DashboardAggregates` shape changes — `tests/pipeline.test.ts`'s exact-keys test is a tripwire for that, but it will not fail on its own if only the dashboard copy drifts.)

## Synthetic labelling (spec requirement, not one of the five numbered rules, but load-bearing)

- **Page banner:** a persistent, sticky element at the top of `dashboard/index.html` — not conditional on any data load succeeding.
- **Per-chart watermark:** every `.chart-card` in `dashboard/render.ts`'s `renderCard` gets a "SYNTHETIC DATA" watermark layered behind its content.
- **Data payload:** every pipeline output carries `synthetic: true` (`pipeline/label.ts`); the dashboard's fetch path (`dashboard/main.ts`) checks this field and refuses to render if it's not exactly `true`, as a defense-in-depth measure against a future data source that forgets the label.
- **Filenames:** `pipeline/label.ts`'s `syntheticFileName` forces every export's filename to carry `.SYNTHETIC.` — `scripts/build-dashboard-data.ts` uses this for the JSON file the dashboard reads, and any future export path should use the same helper rather than constructing a filename by hand.

## What this does *not* cover yet

- No real k-anonymity/suppression review by a statistician.
- No review against the actual VAWA/FVPSA/VOCA confidentiality requirements beyond the structural rules above (region/quarter-only, no free text) — that's a legal/compliance review, not something code review can substitute for.
- No threat-modeling for re-identification via linkage to outside datasets (e.g., a public incident report that narrows a quarter+region combination further). This is worth a dedicated pass before any real data is considered.

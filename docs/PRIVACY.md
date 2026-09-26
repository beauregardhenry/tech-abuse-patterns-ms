# Privacy design

This document records how each privacy rule from the build spec is implemented, where the enforcement actually lives, and where the implementation has known limits. It should be read alongside `docs/DECISIONS.md`, which records what was rejected and what is still open.

**This is v0, synthetic data only.** Nothing here has been reviewed by a statistician or the partner organization. Do not point this pipeline at real survivor data until that review happens and the partner has signed off (see the spec's non-negotiables).

## The principle behind rules 1 and 2

Rule 1 says don't show a small count. But a viewer doesn't only read the numbers on the page. They can also subtract one shown number from another. So the working rule is broader:

> **Any count a viewer can work out exactly from what's shown must be 0 or at least k.**

A shown cell is the obvious case. Less obvious cases, each of which the first version of this pipeline got wrong and which now have a regression test:

- a hidden total that equals the grand total minus the other shown totals;
- a total hidden in one table but shown in another;
- two hidden cells whose combined size (the row total minus the shown cells) is 2. Hidden values are never zero, so both must be exactly 1;
- "records *without* a safety plan" as the grand total minus a shown outcome count.

## The five rules and where they live

### 1. Hide small counts

Every value from 1 to k-1 is suppressed: cells, row totals, column totals and the grand total (`pipeline/suppress.ts`). `k` defaults to 11 (`DEFAULT_SUPPRESSION_THRESHOLD` in `pipeline/disclosure.ts`). It is a parameter on every function that needs it; nothing hardcodes 11 outside that one constant. **The default of 11 is a placeholder.** It was chosen because it matches a threshold some health-data programs use (e.g. CMS), not because it has been validated for this context. The spec says the right threshold has to be confirmed with the partner organization; see `docs/DECISIONS.md`.

**An invalid threshold fails closed.** A `k` below 2, a fraction or `NaN` would suppress nothing. `assertValidThreshold` (in `pipeline/disclosure.ts`) makes every entry point throw instead: `runPipeline`, `suppressTable`, `countOutcomeFlags` and `computeDaysToSafetyPlanStats`. The audit reports such a threshold as a violation too.

A **genuine zero is never suppressed.** A 0 means no records exist for that combination, so there is no one's data to protect, and hiding it would destroy the "where is there no support" signal the state coalition needs. The victim-selection step in `pipeline/suppress.ts` never picks a zero. The "hidden mass" rule below also depends on this: because hidden values are never 0, a viewer knows every hidden value is at least 1.

### 2. Hide back-calculable counts

`pipeline/disclosure.ts` holds the rule. The algorithm (`suppressTable`) and the audit (`findSuppressionViolations`) both use it, so the two can't disagree about what "safe" means.

A table is treated as an augmented matrix: the cells, plus a totals column, a totals row and the grand total in the corner. Every row and every column of that matrix is a line where the parts add up to the total. That includes the totals row (column totals summing to the grand total) and the totals column (row totals summing to the grand total). For each line:

- **It must hide none of its values, or at least two.** A single hidden value is always recoverable by subtraction, whether it's a cell or the total.
- **When its total is shown, the hidden values must add up to at least k.** "Total minus shown values" is the exact combined size of what's hidden, so it's a derivable count like any other.

`suppressTable` hides everything from 1 to k-1, then repeatedly finds a line that breaks either rule and hides one more of its values. It picks the smallest shown non-zero part, or the line's total if no part qualifies. Every shown non-zero value is already at least k, so one extra value always fixes the line it was chosen for. Each step hides one more value, so the loop ends.

**Tables that share totals are suppressed together** (`suppressWithSharedRowMargins` in `pipeline/index.ts`). The by-quarter and by-region tables share their per-abuse-type row totals and the grand total. If they were suppressed independently, a total hidden in one could be read straight off the other. They're suppressed in rounds, and any shared total hidden in either table is forced hidden in both, until nothing changes. The statewide-totals view (`abuseTypeTotals`) isn't suppressed on its own at all. It's built from the harmonized row totals, so it can't disagree with the tables it summarizes. `runPipeline` also rejects any record whose quarter isn't one of the requested quarters. Such a record would be counted by the region table but not the quarter table, and the difference between their totals would itself be a derivable count.

**Values shown next to a total are checked against it.** Outcome flags (`pipeline/outcomes.ts`) are suppressed when the shown grand total minus the count is 1 to k-1. The days-to-safety-plan sample size (`pipeline/stats.ts`) gets the same check against its quarter's shown total.

One more relationship comes from the schema itself. Every record with a days value has a safety plan, so when the safety_plan count and every quarter's sample size are shown, "safety plans with no recorded day count" (the count minus the sum of the sample sizes) is derivable. `protectUnmeasuredSafetyPlans` in `pipeline/index.ts` suppresses the count when that difference is small.

Otherwise these values are independent: no combined total is shown alongside them, so there's no margin among them to protect.

**Enforcement.** `runPipeline` runs `findSuppressionViolations` on every table it builds and **throws if any violation is found**, before anything is labelled or returned. The audit sees only the published values, the same as an attacker would.

**Known limitation.** Every line is checked on its own. That catches everything a viewer can derive from a single row, column or set of totals, but it isn't a full linear-programming audit over *combinations* of lines. In principle, stacking several equations across rows and columns can narrow a hidden value further than any one line can. Solving that in general is a harder problem, which is why statistical agencies use dedicated tools such as τ-ARGUS. It's an open item for statistician review before real data is used (see `docs/DECISIONS.md`).

**Utility.** On a sparse table this over-suppresses, sometimes heavily: most of a 60-record dataset spread over 4 quarters × 6 regions × 6 abuse types ends up suppressed. That's the safe direction to fail in. On the 5,000-record dashboard dataset nothing is suppressed. `tests/suppression.test.ts` also checks that a realistically sized table with one small cell doesn't collapse.

**Labelling.** A suppressed value renders as "suppressed", not "hidden (<11)". Many suppressed values are large counts hidden only to protect a small one, so a "<k" label would be false and would hand a reader a bound to work with.

### 3. Coarsen before storing, and validate at the boundary

The schema (`schema/intakeRecord.ts`) accepts only a `region` (a closed enum, never a county) and a `quarter` (`YYYY-Qn`, never an exact date). There is no field for an exact location or timestamp, so precision is lost at intake, not later. `IntakeRecordSchema` is `.strict()`, so no other field (free text, name, age, address) can be attached at all. Other rules the schema enforces:

- `days_to_safety_plan` is capped at `MAX_DAYS_TO_SAFETY_PLAN` (365, a placeholder).
- A days value requires a `safety_plan` outcome.
- An outcome can't be repeated.

**The schema is enforced where data enters the pipeline**, not just at the type level. `runPipeline` takes `unknown[]` and parses every record, throwing on the first invalid one. The error names the record index, field paths and issue codes, **never values**: a rejected record's content is exactly what this pipeline keeps out of every output, error messages and logs included. `tests/pipeline.test.ts` checks that free text in a rejected record doesn't appear in the error.

**No single record can dominate a published statistic.** Days-to-safety-plan is published as a **median**, not a mean. In testing, one record of 100,000 days pushed a quarter's mean to 9,093.6. A median of at least k values can't be moved past a single record's neighbours, and the cap above rejects that kind of value at intake anyway.

### 4. Show the data's age

`pipeline/label.ts`'s `labelSynthetic` stamps every pipeline output with `dataAsOf`, truncated to the day (`toISOString().slice(0, 10)`). No code path attaches a live timestamp. The dashboard renders it as "Data last refreshed: …" and says the numbers are synthetic and never real-time. The dashboard's own guard (below) rejects a `dataAsOf` that isn't a day-level `YYYY-MM-DD`.

### 5. Enforce it before display

Three layers:

- **The pipeline** audits every table and refuses to emit anything that fails (rule 2).
- **The dashboard re-checks the data file before rendering** (`dashboard/validate.ts`). It rejects the file outright if any of these hold:
  - the data isn't labelled synthetic;
  - the threshold isn't an integer of at least 2, or differs between tables;
  - any shown count is from 1 to k-1;
  - a median appears without a publishable sample size;
  - anything is the wrong shape.

  It rebuilds every object from known fields only, so an unexpected field in the file (a record-shaped object, say) never reaches the renderer. This guards against a stale, hand-edited or tampered file. The full disclosure audit stays in the pipeline, since the dashboard can't import it.
- **The dashboard has no code path to record-level data.** `dashboard/types.ts` is a local copy of the JSON contract; nothing in `dashboard/` imports `schema/`, `generator/` or `pipeline/`. Trade-off: that copy has to be kept in sync by hand. `tests/pipeline.test.ts`'s exact-keys test and `tests/dashboard-validate.test.ts`, which runs real pipeline output through the guard, are the tripwires.

The page also sets a strict **Content-Security-Policy**: same-origin scripts, styles and data only, and no inline script. It sets **`referrer: no-referrer`** too, so following a link off the page doesn't tell another site where the visitor came from. All rendering uses `textContent`, never `innerHTML`.

## Synthetic labelling (spec requirement, not one of the five numbered rules, but load-bearing)

- **Page banner:** a persistent, sticky element at the top of `dashboard/index.html`. It shows even if the data fails to load.
- **Per-chart watermark:** every `.chart-card` in `dashboard/render.ts`'s `renderCard` gets a "SYNTHETIC DATA" watermark behind its content.
- **Data payload:** every pipeline output carries `synthetic: true` (`pipeline/label.ts`). `dashboard/validate.ts` refuses to render anything not labelled exactly that way.
- **Filenames:** `pipeline/label.ts`'s `syntheticFileName` puts `.SYNTHETIC.` in every export's filename. `scripts/build-dashboard-data.ts` uses it for the file the dashboard reads, and any future export should use it too.

## Build and CI hygiene that affects privacy

- Every workflow's Actions token is read-only. The ratchet workflows commit updated baselines with a dedicated write-enabled **deploy key** (secret `RATCHET_DEPLOY_KEY`). The key is handed only to the final push step (`scripts/push-ratchet-baseline.sh`), never to dependency installs or the test suite. It lives in a temp file only while that step runs.
  - It's pushed over SSH against GitHub's published host keys, which are fetched over TLS rather than trusted on first contact.
  - The key sits on `main`'s ruleset bypass list, so the baseline commit isn't blocked by the required CI check.
  - `.github/workflows/verify-ratchet-key.yml` proves the key can push; run it manually after adding or rotating the key.
- Every workflow installs with `npm ci --ignore-scripts`, so a compromised dependency's install script doesn't run in CI.

## What this does *not* cover yet

- No real k-anonymity/suppression review by a statistician, including the multi-line limitation above.
- No review against the actual VAWA/FVPSA/VOCA confidentiality requirements beyond the structural rules above (region/quarter only, no free text). That's a legal and compliance review, which code review can't substitute for.
- No threat modeling for re-identification by linking to outside datasets (e.g. a public incident report that narrows a quarter+region combination further).
- No protection against differencing *across releases*. Comparing two refreshes of the dashboard reveals what changed between them. Rule 4's coarse, periodic refresh limits this but doesn't eliminate it.

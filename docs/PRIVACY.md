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

Every value from 1 to k-1 is suppressed: cells, row totals, column totals and the grand total (`pipeline/suppress.ts`). `k` defaults to 11 (`DEFAULT_SUPPRESSION_THRESHOLD` in `shared/disclosure.ts`). It is a parameter on every function that needs it; nothing hardcodes 11 outside that one constant. **The default of 11 is a placeholder.** It was chosen because it matches a threshold some health-data programs use (e.g. CMS), not because it has been validated for this context. The spec says the right threshold has to be confirmed with the partner organization; see `docs/DECISIONS.md`.

**An invalid threshold fails closed.** A `k` below 2, a fraction or `NaN` would suppress nothing. `assertValidThreshold` (in `shared/disclosure.ts`) makes every entry point throw instead: `runPipeline`, `suppressTable`, `countOutcomeFlags` and `computeDaysToSafetyPlanStats`. The audit reports such a threshold as a violation too.

A **genuine zero is never suppressed.** A 0 means no records exist for that combination, so there is no one's data to protect, and hiding it would destroy the "where is there no support" signal the state coalition needs. The victim-selection step in `pipeline/suppress.ts` never picks a zero. The exact-sum rules below also depend on this: because hidden values are never 0, a viewer knows every hidden value is at least 1.

### 2. Hide back-calculable counts

`shared/disclosure.ts` holds the rules. The algorithm (`suppressTable`), the pipeline's audit (`findSuppressionViolations`) and the dashboard's own check (`dashboard/validate.ts`) all use it, so the three can't disagree about what "safe" means.

A table is treated as an augmented matrix: the cells, plus a totals column, a totals row and the grand total in the corner. Every row and every column of that matrix is a line where the parts add up to the total. That includes the totals row (column totals summing to the grand total) and the totals column (row totals summing to the grand total).

A viewer can add and subtract any combination of those lines, not just read one at a time. Combining a set of lines cancels every value whose row and column are both in the set, and leaves an equation over the values that cross it. So for **every combination of lines** in a table:

- **One hidden value crossing it is recoverable outright**, whatever its size. For a single line, that's the familiar "total minus the shown parts".
- **When the hidden values crossing it add up exactly, their sum must be at least k.** It's a derivable count like any other. For a single line with a shown total, that's "total minus shown values".
- **That sum must also be more than the number of hidden values.** Hidden values are never 0, so three hidden values adding up to exactly 3 are all exactly 1. This only bites when k is small (a line here has at most seven values), but k is configurable.

A table has at most 14 lines, and only lines touching a hidden value matter, so every combination is checked exhaustively, not sampled.

`suppressTable` hides everything from 1 to k-1, then repeatedly finds a combination that breaks a rule, checking single lines first, and hides one more value crossing it: a cell before a total, the smallest first. Every shown non-zero value is already at least k, so one extra value always fixes the combination it was chosen for: it adds at least k to the exact sum, or turns the sum into a difference that pins nothing. Each step hides one more value, so the loop ends. A combination that gives something away always has a shown non-zero value crossing it, so the loop never runs out of candidates.

**Tables that share totals are suppressed together** (`suppressWithSharedRowMargins` in `pipeline/index.ts`). The by-quarter and by-region tables share their per-abuse-type row totals and the grand total. If they were suppressed independently, a total hidden in one could be read straight off the other. They're suppressed in rounds, and any shared total hidden in either table is forced hidden in both, until nothing changes. Then `shared/linked.ts` checks the tables together: their shared totals must match exactly, shown or hidden alike, and no hidden value may be exactly recoverable from all their equations combined. That second check is exact linear algebra over the rationals, with no rounding. The statewide-totals view (`abuseTypeTotals`) isn't suppressed on its own at all. It's built from the harmonized row totals, so it can't disagree with the tables it summarizes. `runPipeline` also rejects any record whose quarter isn't one of the requested quarters. Such a record would be counted by the region table but not the quarter table, and the difference between their totals would itself be a derivable count.

**Values shown next to a total are checked against it.** Outcome flags (`pipeline/outcomes.ts`) are suppressed when the shown grand total minus the count is 1 to k-1. The days-to-safety-plan sample size (`pipeline/stats.ts`) gets the same check against its quarter's shown total.

One more relationship comes from the schema itself. Every record with a days value has a safety plan, so when the safety_plan count and every quarter's sample size are shown, "safety plans with no recorded day count" (the count minus the sum of the sample sizes) is derivable. `protectUnmeasuredSafetyPlans` in `pipeline/index.ts` suppresses the count when that difference is small.

Otherwise these values are independent: no combined total is shown alongside them, so there's no margin among them to protect.

**Enforcement.** `runPipeline` runs `findSuppressionViolations` on every table it builds, then the cross-table check, and **throws if any violation is found**, before anything is labelled or returned. The audit sees only the published values, the same as an attacker would. There's no automatic fix for a cross-table failure; the pipeline fails closed. In testing it has never fired: 12,000 randomized runs (k from 3 to 20, 15 to 546 records) found no hidden value recoverable across tables once each table was safe on its own.

**Error messages never carry a value.** A violation names where and which rule, never the number. These messages reach logs, and the dashboard shows its own on the page. A message quoting the small count it had just rejected would publish it anyway.

**Known limitations.** A second review found that checking each line on its own missed real leaks. In 59 of 3,000 randomized runs, a hidden value could be worked out exactly by combining several lines, including a count of 7 at k=11. The combination check above closes that, with a regression test built from one of those tables. What's still not covered:

- **Ranges.** The rules stop exact values and small exact sums. A viewer can still narrow a hidden value to a range, e.g. "between 1 and 10" when two hidden cells add up to 11. That's by design here, but a statistician may want a minimum protection range. `npm run analyze:ranges` measures these ranges exactly (a linear program per hidden value, over both tables at once) across dataset sizes and thresholds.
- **Weighted combinations.** Within a table, each line is used once in a combination. Combinations that use a line twice aren't searched, and neither are the inequalities that hidden values being at least 1 adds. For these tables, any value an equation pins down exactly also shows up in a combination that uses each line once, and the exact cross-table check covers the same ground again.
- **Across tables**, only exact recovery is checked, not small sums.
- **Across releases**, nothing is checked yet, and comparing releases does leak. See "Comparing releases" below.

A general audit of all of this is the kind of problem statistical agencies use dedicated tools such as τ-ARGUS for. It stays an open item for statistician review before real data is used (see `docs/DECISIONS.md`).

**Utility.** On a sparse table this over-suppresses, sometimes heavily: most of a 60-record dataset spread over 4 quarters × 6 regions × 6 abuse types ends up suppressed. That's the safe direction to fail in. On the 5,000-record dashboard dataset nothing is suppressed. `tests/suppression.test.ts` also checks that a realistically sized table with one small cell doesn't collapse.

**Labelling.** A suppressed value renders as "suppressed", not "hidden (<11)". Many suppressed values are large counts hidden only to protect a small one, so a "<k" label would be false and would hand a reader a bound to work with.

**Comparing releases (measured, not fixed).** Every check above looks at one release. Anyone can save a copy of a public page, so assume a viewer keeps every release and compares them. `npm run analyze:releases` (`scripts/releases.ts`) measures what that gives away under four release policies over two years of quarters. It finds every count a viewer can compute exactly, using exact linear algebra plus the fact that a shown zero makes every count under it zero. It then recomputes each finding from published values alone and checks it against the data. No single release exposed anything in the richer model either. Comparing them exposes two things:

- **Subtracting cumulative tables.** The by-region table covers every quarter in a release. If the next release adds a quarter and keeps the others, the old by-region table subtracted from the new one is the new quarter's abuse type × region counts. No release shows those, so nothing checks them against k. The same goes for region totals and outcome counts. With a quarter added to each release, 49% to 99% of the small (1 to k-1) counts in each added quarter were exposed, more with larger datasets: at 5,000 records a year, 1,133 of 1,148. Refreshing year to date, resetting each January, exposed 11% to 32%.
- **Suppression patterns that differ between releases.** When windows overlap, the same value appears in several releases, and each release picks its complementary suppressions on its own. In one synthetic dataset, release 1 hid spyware in 2025-Q1 and 2025-Q3 and showed 2025-Q4. Release 2 hid 2025-Q3 and, to protect it, 2025-Q4, which release 1 had already shown. Release 2's row then gives 2025-Q3, and release 1's row gives 2025-Q1. At 250 records a year, comparing releases recovered 8% to 12% of small suppressed values under every overlapping policy, rolling four-quarter windows included. At 1,000 and 5,000 records a year it recovered none.

One release per calendar year, each covering a year no other release covers, exposed nothing beyond what each release shows. Rolling four-quarter windows exposed no never-published count exactly. But only exact recovery is measured: consecutive rolling releases differ by the new quarter minus the dropped one, which gives bounds once counts can't be negative. Not modelled: records entered late that change a quarter already published (each revision leaks the way subtraction does), and the days-to-safety-plan medians.

As everywhere here, the data is synthetic with arbitrary distributions, so these rates show how the policies behave, not how real data would come out. Candidate fixes are listed under "Release policy" in `docs/DECISIONS.md`. None is implemented; which one fits is a decision for the statistician and the partner organization.

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
- **The dashboard re-checks the data file before rendering** (`dashboard/validate.ts`). It runs the same disclosure audit as the pipeline, from `shared/`, and rejects the file outright if any of these hold:
  - the data isn't labelled synthetic, or its as-of date isn't a real calendar day;
  - the threshold isn't an integer of at least 2, or differs between tables;
  - any shown count is from 1 to k-1;
  - any combination of lines gives a hidden value away;
  - the tables' shared totals don't match, or combining the tables recovers a hidden value;
  - a median appears without a publishable sample size;
  - anything is the wrong shape.

  It rebuilds every object from known fields only, so an unexpected field in the file (a record-shaped object, say) never reaches the renderer. This guards against a stale, hand-edited or tampered file, including one written by an older version of the pipeline with weaker rules. Its error message is shown on the page, so it never quotes a value from the file.
- **The dashboard has no code path to record-level data.** `dashboard/types.ts` is a local copy of the JSON contract. The dashboard build compiles only `dashboard/` and `shared/`, and neither imports `schema/`, `generator/` or `pipeline/`; `tests/boundary.test.ts` enforces that. Trade-off: that copy has to be kept in sync by hand. `tests/pipeline.test.ts`'s exact-keys test and `tests/dashboard-validate.test.ts`, which runs real pipeline output through the guard, are the tripwires.

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

- No real k-anonymity/suppression review by a statistician, including the known limitations above.
- No review against the actual VAWA/FVPSA/VOCA confidentiality requirements beyond the structural rules above (region/quarter only, no free text). That's a legal and compliance review, which code review can't substitute for.
- No threat modeling for re-identification by linking to outside datasets (e.g. a public incident report that narrows a quarter+region combination further).
- No protection against identifying a *program*. If one program serves a whole region, that region's numbers are that program's caseload. That discloses something about an organization, not a person, but it's still a disclosure. Region design has to account for it (see `docs/DECISIONS.md`, Region definitions).
- No protection against comparing releases. It's measured (see "Comparing releases" under rule 2), and the fix waits on a release-policy decision.

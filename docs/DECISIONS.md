# Decisions

What was rejected, what was chosen and why, and what's still open. See `docs/PRIVACY.md` for the detail on how the privacy rules are implemented — this file is about the choices themselves, not their code.

## Rejected

**A case dashboard for individual survivors.** This was considered and rejected before this build started (per the handoff spec, from an earlier Cowork planning thread). Reasons: it would put the single most sensitive category of data — identifiable records about specific survivors — in one place, which is precisely the concentration-of-risk pattern the other design choices here are trying to avoid; it conflicts with VAWA/FVPSA/VOCA confidentiality rules around survivor data; and shelters already have access to purpose-built comparable databases from established vendors for that job (see `techsafety.org/comparable-database-101` and the HMIS Comparable Database Manual, both linked from the original spec). This project is v0 of the aggregate, de-identified "Version 2" dashboard specifically because the case-level option was already ruled out.

## Chosen, this build

**Node.js + TypeScript + zod, no framework.** No stack preference was given. TypeScript end-to-end (schema, generator, pipeline, and the dashboard's own separate build) means the `IntakeRecord` shape, the suppression logic's types, and the dashboard's data contract are all statically checked. zod's `.strict()` schema mode was chosen specifically because the spec calls for the schema to make excluded fields (free text, names, exact location) *impossible to add*, not just unused by convention — a TypeScript interface alone doesn't enforce that at runtime against untrusted input; a zod parse does.

**Plain HTML/TS/CSS dashboard, no bundler, no chart library, tables instead of charts.** The three audience questions (state coalition, funders, legislators) all call for exact numbers people can quote, not trend lines — a table serves that better than a chart, and it's more accessible by default. Avoiding a bundler and chart dependency keeps the audit surface small for a privacy-focused tool and keeps the whole dashboard inspectable as plain, readable source. This can change once there's a concrete need (e.g. a trend visualization a coalition partner specifically asks for) — it wasn't ruled out, just not needed for v0.

**Suppression implemented for 2-way cross-tabs (totals included) and the specific cross-table relationships the current views create**, not a general N-way disclosure-control solver. See `docs/PRIVACY.md` rule 2. This is a scope decision for v0. It is not a claim that this pipeline can safely support any view. A new cross-tab with more than two dimensions, a new table that shares totals with an existing one, or a new number shown next to an existing total all need their own suppression review before shipping.

**Hardening pass after v0 (reproduced leaks, then fixed).** A review reproduced four ways the first version's output could leak a small count while passing its own audit. Each one now has a regression test, and the audit catches all of them:

- a hidden total recoverable from the grand total;
- a total hidden in one table but shown in another;
- two hidden cells whose derivable sum pinned both to exactly 1;
- a threshold of 0, 1 or `NaN` silently suppressing nothing.

Choices made in that pass:

- **Totals are treated as cells.** Every row and column of the table-plus-totals matrix is checked by one shared rule (`shared/disclosure.ts`). This replaced separate row, column and grand-total checks that never protected the totals themselves.
- **Hidden values in a line with a shown total must add up to at least k.** This was chosen over tracking each hidden value's possible range: it's the same threshold rule applied to a derived count, so it's easy to explain and to audit.
- **Shared totals are hidden identically across tables.** The statewide-totals view is now derived from the cross-tabs' shared totals, not suppressed on its own.
- **The median replaced the mean** for days to safety plan, so no single record can dominate the published figure.
- **"Suppressed" replaced "hidden (<11)"** as the label, because the "<11" bound was false for values hidden to protect others.

**Second hardening pass: combinations of lines.** A second review tested the rules against exact linear algebra, not just against each line. It reproduced these problems:

- **Leaks from combining lines.** In 59 of 3,000 randomized pipeline runs, a hidden value could be worked out exactly by combining several rows and columns, though every line on its own passed the audit. One was a count of 7 at k=11. The pattern: a hidden cell that was the only link between two separate groups of hidden cells.
- **Values pinned to 1 at small k.** With k of 2 or 3, three hidden 1s next to a shown total of 3 passed the audit, though each must be exactly 1.
- **A weak dashboard check.** The dashboard's check didn't run the audit, so a file with one recoverable hidden value rendered.
- **Values in error messages.** Error messages quoted the values they rejected. The dashboard shows its error on the page, so a rejected small count would have been displayed anyway.
- **Repeated quarters.** A repeated requested quarter produced a zero column next to copied statistics.

Each problem now has a regression test, and the audit rejects each one. Choices made in that pass:

- **Every combination of lines in a table is checked exhaustively**, each line used once. A linear-programming solver in the style of τ-ARGUS was rejected: it would need a solver dependency or a hand-written simplex method in the privacy-critical path. A table here has at most 14 lines, so exhaustive search is small, fast and easy to audit. What it doesn't cover is listed in `docs/PRIVACY.md` under "Known limitations".
- **Across tables, an exact check fails closed rather than fixing itself.** Shared totals must match, and no hidden value may be recoverable from all the tables' equations together, checked exactly over the rationals. It has never fired in 12,000 randomized runs, so an automatic fix would be untested code in the privacy path. Refusing to publish is the safe failure.
- **One set of rules in `shared/`**, compiled into both the pipeline and the dashboard. The dashboard's check now runs the same audit, not a weaker copy. `shared/` may never import `schema/`, `generator/` or `pipeline/`, and a test enforces it.
- **Violation messages name the place and the rule, never the value.**

**Records are validated where they enter the pipeline, and errors never echo record content.** `runPipeline` takes `unknown[]`, not a TypeScript type the data was never checked against. A validation error names only the record index, field paths and issue codes. A more helpful error that quoted the offending value was rejected, because the whole point of this pipeline is that record content never reaches any output, logs included.

**`finding_detail`/`platform` category lists, region names, and every generated distribution are placeholders.** `schema/intakeRecord.ts`'s `FINDING_DETAILS`/`PLATFORMS` lists and `REGIONS` (`Region A`–`F`) are illustrative scaffolding so the schema and pipeline have something concrete to validate against — none of them are the real, coalition-approved lists yet (see Open questions below). Likewise, every distribution in `generator/generate.ts` (abuse-type trends, outcome rates, days-to-safety-plan) is arbitrary and picked to exercise the pipeline and produce a dashboard that isn't empty — the spec is explicit that these must never be described as realistic, and they aren't calibrated to any real statistic.

## Known gap

**The funders' question has two halves, and v0 only answers one.** "How many advocates can now handle tech abuse cases, and how fast do survivors get a safety plan?" — the `days_to_safety_plan` half is answered (`pipeline/stats.ts`, rendered in the "Days to safety plan, by quarter" card). The "how many advocates" half has no home in the `IntakeRecord` schema at all — advocate training/capacity isn't a property of an intake record, it's a property of the workforce, and needs its own data source (e.g. a roster or training-log input) that doesn't exist in this v0. The dashboard says this explicitly in the Outcomes card rather than fabricating a number or silently dropping the question. Whoever picks this up next should treat it as a new input to design, not something to backfill into the current schema.

## Open questions (carried over from the spec, still open)

- **Suppression threshold and method.** Implemented with a default of k=11, primary and complementary cell suppression, and rules that stop any combination of lines from recovering a hidden value or an exact sum below k (see `docs/PRIVACY.md`). None of this is confirmed as the right threshold or method for this context yet; that's the partner organization's or a statistician's call, not an engineering one. The review should also cover what's still unchecked: the ranges a viewer can narrow hidden values to, weighted combinations of lines, small sums across tables, and comparing releases (next item).
- **Release policy.** How often the dashboard is refreshed, which quarters each release covers, and whether a published quarter can ever change. `npm run analyze:releases` shows that a viewer who compares releases can recover counts no single release gives away (see "Comparing releases" in `docs/PRIVACY.md`). The options below are candidates, not a decision:
  - **One release per period no other release covers**, e.g. one per calendar year, frozen once published. It exposed nothing in the analysis. The cost is timeliness: a quarter waits for its year.
  - **Quarterly releases checked against every earlier one.** Before publishing, treat every value an earlier release showed as known, and suppress more until nothing new is recoverable. That would be the analysis's exact check, moved into the pipeline and made fail-closed. Suppression would grow over time, and the pipeline would need to keep every past release (published aggregates only). Needs design.
  - **Region tables per quarter only**, never a region total over several quarters, with the k rules applied to each quarter. This removes the subtraction leak but not the one from differing suppression patterns, which still needs the check above. Sparse regions would be suppressed much more.
  - **Rolling windows.** No never-published count was exposed exactly, but the suppression-pattern leak remains at small sizes, and the bounds rolling windows allow aren't measured.

  Whatever the choice, records entered late shouldn't silently change a published quarter: each revision leaks the way subtraction does, so it needs the same check as a new release.
- **Upper bound on `days_to_safety_plan`.** Set to 365 (`MAX_DAYS_TO_SAFETY_PLAN`) as a placeholder, so garbage values are rejected at intake. The real bound, and whether a legitimately longer wait should be capped or stored differently, needs advocate input.
- **Region definitions.** `Region A`–`F` are placeholders. The real multi-county regions need to come from the coalition; per the spec, they must never be county-level. Mississippi may have only about 10 domestic violence programs (see `docs/EXISTING_DATA.md`). A region served by a single program would show that program's caseload, so region boundaries also need to avoid identifying programs.
- **Final `finding_detail`/`platform` lists.** Current lists in `schema/intakeRecord.ts` are a starting scaffold. The real lists need to come from ISDi/Sherloc output and advocate input (see the sources linked in the original spec).
- **Whether comparable Southern/rural tech-abuse data is already published elsewhere.** A first pass is in `docs/EXISTING_DATA.md`. It found no published, advocate-reported, recurring tech-abuse data for Mississippi, the Deep South or rural areas below the state level. The closest are population surveys, some with state or urban/rural breakdowns, and national surveys of advocates. It isn't a systematic review: several sources were seen only as search excerpts, and unpublished coalition data may exist. Its follow-ups list what to ask the coalition and NNEDV.

## Non-negotiables (reaffirmed, unchanged from the spec)

- No offensive capability of any kind, and no feature for tracking or identifying individuals.
- No case dashboard for individual survivors (see Rejected, above).
- No real data in this project until the partner organization signs off and a VAWA/FVPSA/VOCA confidentiality review is done.
- No survivor stories or screenshots in public materials without advocate-approved consent.

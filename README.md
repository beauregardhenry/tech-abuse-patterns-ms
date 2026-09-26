# tech-abuse-patterns-ms

A nonprofit project to help domestic violence advocates in rural Mississippi deal with tech-enabled abuse.

This repository holds **v0** of the dashboard: an aggregate, de-identified view of tech abuse patterns across shelters and clinics, built and tested against **synthetic data only**. It is not a case dashboard for individual survivors — that option was considered and rejected (see `docs/DECISIONS.md`). No real survivor data exists in this project, and none may be added without partner sign-off and a confidentiality review.

Every chart on the dashboard answers one of three questions:

| Audience | Question |
|---|---|
| State coalition | Which kinds of tech abuse are rising, and where is there no support? |
| Funders | How many advocates can now handle tech abuse cases, and how fast do survivors get a safety plan? |
| Legislators | What does tech abuse look like in Mississippi, in numbers that can support a bill? |

Read `docs/PRIVACY.md` for how the privacy rules (suppressing small counts, protecting against back-calculation, coarsened data, labelled synthetic data) are actually implemented and enforced, and `docs/DECISIONS.md` for what was rejected, what's a placeholder pending partner/coalition input, and what's still open.

## Repo layout

```
/schema        intake record definition + validation (zod)
/generator     seeded synthetic data generator
/pipeline      aggregation + suppression (the privacy-critical core)
/dashboard     front end; consumes suppressed aggregates only, never raw records
/scripts       build-time scripts (e.g. generating the dashboard's data file)
/tests         vitest suite — privacy/suppression tests are the priority
/docs          PRIVACY.md and DECISIONS.md
```

## Setup

Requires Node.js and npm.

```
npm install
```

## Running

```
npm run build           # typecheck + compile schema/generator/pipeline/scripts to dist/
npm test                # run the full test suite (privacy/suppression tests included)
npm run build:data      # generate a fresh synthetic dataset -> dashboard/data/aggregates.SYNTHETIC.json
npm run build:dashboard # compile the browser-side dashboard TypeScript in place
```

Then serve the `dashboard/` directory with any static file server and open it, e.g.:

```
npx http-server dashboard -p 8080
```

`dashboard/data/*.json` is generated output (gitignored) — run `build:data` before serving if it's missing.

## Testing priority

Per working practice, the privacy rules are the highest-priority area and are tested first: `tests/schema.test.ts` (rejecting free text/excluded fields), `tests/generator.test.ts` (determinism), `tests/suppression.test.ts` and `tests/pipeline.test.ts` (no cell below k, no back-calculable cell, synthetic labelling, no record-level data reaching the rendering layer). All of these must be green before any dashboard change is considered done.

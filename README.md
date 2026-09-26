# tech-abuse-patterns-ms

A nonprofit project to help domestic violence advocates in rural Mississippi deal with tech-enabled abuse.

This repository holds **v0** of the dashboard: an aggregate, de-identified view of tech abuse patterns across shelters and clinics, built and tested against **synthetic data only**. It is not a case dashboard for individual survivors — that option was considered and rejected (see `docs/DECISIONS.md`). No real survivor data exists in this project, and none may be added without partner sign-off and a confidentiality review.

Every chart on the dashboard answers one of three questions:

| Audience | Question |
|---|---|
| State coalition | Which kinds of tech abuse are rising, and where is there no support? |
| Funders | How many advocates can now handle tech abuse cases, and how fast do survivors get a safety plan? |
| Legislators | What does tech abuse look like in Mississippi, in numbers that can support a bill? |

Read `docs/PRIVACY.md` for how the privacy rules (suppressing small counts, protecting against back-calculation, coarsened data, labelled synthetic data) are actually implemented and enforced, and `docs/DECISIONS.md` for what was rejected, what's a placeholder pending partner/coalition input, and what's still open. `docs/EXISTING_DATA.md` covers what comparable data already exists.

## Repo layout

```
/schema        intake record definition + validation (zod)
/generator     seeded synthetic data generator
/pipeline      aggregation + suppression (the privacy-critical core)
/dashboard     front end; consumes suppressed aggregates only, never raw records
/scripts       build-time scripts (e.g. generating the dashboard's data file)
/tests         vitest suite — privacy/suppression tests are the priority
/docs          PRIVACY.md, DECISIONS.md and EXISTING_DATA.md
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
npm run build:dashboard # compile the browser-side dashboard TypeScript into dashboard/js/
```

Then serve the `dashboard/` directory with any static file server and open it, e.g.:

```
npx http-server dashboard -p 8080
```

`dashboard/data/*.json` and `dashboard/js/` are generated output (gitignored), so run `build:data` and `build:dashboard` before serving if they're missing.

## Testing priority

Per working practice, the privacy rules are the highest-priority area and are tested first. They must all be green before any dashboard change is considered done:

- `tests/schema.test.ts`: rejects free text and excluded fields, enforces the days cap and cross-field rules.
- `tests/generator.test.ts`: the generator is deterministic for a given seed.
- `tests/suppression.test.ts` and `tests/pipeline.test.ts`:
  - no shown count below k;
  - no hidden value recoverable by subtraction, totals included;
  - totals shared between tables stay consistent;
  - input is validated at the pipeline boundary;
  - every output is labelled synthetic;
  - no record-level data reaches the rendering layer.
- `tests/dashboard-validate.test.ts`: the dashboard refuses a tampered data file.

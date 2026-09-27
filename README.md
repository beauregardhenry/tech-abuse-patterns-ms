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
/shared        the disclosure rules, used by both the pipeline and the dashboard's own check
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
npm run build           # typecheck + compile schema/generator/pipeline/shared/scripts to dist/
npm test                # run the full test suite (privacy/suppression tests included)
npm run build:data      # generate a fresh synthetic dataset -> dashboard/data/aggregates.SYNTHETIC.json
npm run build:dashboard # compile the browser-side dashboard TypeScript into dashboard/js/
npm run analyze:ranges  # measure how narrowly a viewer can bound suppressed values (for the disclosure review)
npm run build:demo      # build the partner demo page into demo/dist/ (see "Partner demo" below)
```

Then serve the `dashboard/` directory with any static file server and open it, e.g.:

```
npx http-server dashboard -p 8080
```

`dashboard/data/*.json` and `dashboard/js/` are generated output (gitignored), so run `build:data` and `build:dashboard` before serving if they're missing.

## Partner demo

`npm run build:demo` builds a clickable demo for prospective partner organizations into `demo/dist/`. It's the page in `demo/template.html` with two synthetic datasets from the real pipeline embedded: 5,000 records, and 250 records so suppression is visible. It imports the dashboard's own compiled render and check modules, so it shows exactly what the dashboard would. CI builds it on every change, so it can't silently break.

It's published as a private claude.ai page, shared only with the people it's meant for. To update it, rebuild and republish `demo/dist/tech-abuse-demo.html` to the same page, with the `js/` folder alongside it at the same paths.

## Testing priority

Per working practice, the privacy rules are the highest-priority area and are tested first. They must all be green before any dashboard change is considered done:

- `tests/schema.test.ts`: rejects free text and excluded fields, enforces the days cap and cross-field rules.
- `tests/generator.test.ts`: the generator is deterministic for a given seed.
- `tests/suppression.test.ts` and `tests/pipeline.test.ts`:
  - no shown count below k;
  - no hidden value recoverable by any combination of rows and columns, totals included;
  - totals shared between tables stay consistent, and combining the tables recovers nothing;
  - input is validated at the pipeline boundary;
  - every output is labelled synthetic;
  - no record-level data reaches the rendering layer.
- `tests/linked.test.ts`: the exact cross-table check.
- `tests/dashboard-validate.test.ts`: the dashboard runs the same audit and refuses a tampered data file.
- `tests/boundary.test.ts`: the dashboard and `shared/` never import record-level code.

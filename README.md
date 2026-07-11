# Engineering Capacity Planner

A local, single-user sprint-planning tool that answers one question well:
**"Given today's date and the work remaining, are our promised QA / testing /
launch dates still realistic?"**

It pulls epic/story data into a local SQLite database, layers on team-capacity
inputs (per-member velocity, PTO, on-call), and renders a red/yellow/green
timeline against each epic's gating "relevant day."

See [`docs/sprint-planning-tool-project-plan.md`](docs/sprint-planning-tool-project-plan.md)
for the full spec.

## Milestone 1 (Phases 1–3)

The first milestone proves the core hypothesis: **synthetic data → capacity
engine → colored timeline**. It is built in independently reviewable phases,
one pull request each.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **1** | Data model + synthetic importer | ✅ this PR |
| **2** | Capacity engine + exhaustive unit tests | ⏳ next |
| **3** | Calendar / timeline UI (red/yellow/green) | ⏳ |

## Stack

- **Monorepo** via npm workspaces.
- **`@ecp/shared`** — TypeScript domain model, the importer contract, and the
  configurable settings/defaults. Consumed by the backend, the engine
  (Phase 2), and the UI (Phase 3).
- **`@ecp/backend`** — Node + TypeScript. SQLite via `better-sqlite3`, a
  minimal Fastify API, and the `SyntheticImporter`. Tests run on
  [Vitest](https://vitest.dev).

Everything sits behind a **pluggable importer interface** so a real Jira
adapter can drop in later (Phase 7) without touching the engine or UI.

## What Phase 1 delivers

- **Domain schema** (`packages/shared/src/domain.ts`) — teams & cadence,
  roster, PTO, on-call, velocity overrides, epics, "relevant day" milestones,
  stories, work items, dependencies, and a key/value settings store.
- **SQLite schema + persistence** (`packages/backend/src/db`) — foreign keys
  enforced, transactional writes, lossless read/write round-trip.
- **`SyntheticImporter`** (`packages/backend/src/importer`) — a deterministic,
  seedable generator producing a ~50-item epic grouped under user stories with
  varied points/statuses/assignees and a dependency web that includes a few
  high-leverage blockers. Always a DAG.
- **Configurable knobs** — sprint cadence (default 2-week sprints starting
  Tuesday, Mon–Fri), on-call multiplier (0.5), and green/yellow/red buffer
  thresholds live in the settings store with sensible defaults. Jira mapping
  fields are present but inert.

## Getting started

```bash
npm install          # installs workspaces (builds better-sqlite3 native addon)
npm run build        # type-check + emit
npm test             # run all Vitest suites
```

### Seed and inspect a database

Phase 1 is verifiable via DB inspection. This script generates the synthetic
epic, writes it to SQLite, reads it back, and prints a summary:

```bash
npm run seed                          # → ./data/ecp.db
npm run seed -- --seed 7 --items 60   # different seed / size
```

Example output:

```
Seeded synthetic dataset → ./data/ecp.db (seed=1)

  Teams:        1
  Members:      5 (4 active)
  Epic:         CKT — Checkout Revamp
  Stories:      10
  Work items:   50  (188 points)
  Dependencies: 38
  Status mix:   {"In Review":10,"Done":12,"In Progress":7,"To Do":21}
  Gating day:   First QA in stage pass @ 2026-03-02
  Top blockers (transitive dependents):
    CKT-2    blocks 16  — Document currency formatting
    CKT-1    blocks 10  — Fix analytics events
    ...
```

### Run the API

```bash
npm run seed                                   # ensure ./data/ecp.db exists
npm run dev --workspace @ecp/backend           # Fastify on http://127.0.0.1:3001
curl http://127.0.0.1:3001/api/summary
```

## Layout

```
packages/
  shared/     @ecp/shared  — domain types, importer interface, settings defaults
  backend/    @ecp/backend — SQLite schema/persistence, SyntheticImporter, API
    src/
      db/         schema.ts, database.ts, persist.ts
      importer/   rng.ts, synthetic.ts
      util/       dates.ts
      scripts/    seed.ts
      server.ts
    test/       vitest suites
docs/         project plan
```

## Conventions

- Dates are ISO `YYYY-MM-DD` strings; weekdays use `Date.getUTCDay()` (0 = Sun).
- The synthetic generator is fully deterministic per seed, so tests assert on
  exact output.
- The SQLite file is the shareable unit and is gitignored — regenerate it with
  `npm run seed`.

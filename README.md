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
| **1** | Data model + synthetic importer | ✅ merged |
| **2** | Capacity engine + exhaustive unit tests | ✅ merged |
| **3** | Calendar / timeline UI (red/yellow/green) | ✅ this PR |

Milestone 1 is complete with this PR.

## Stack

- **Monorepo** via npm workspaces.
- **`@ecp/shared`** — TypeScript domain model, the importer contract, pure
  date/calendar helpers, and the configurable settings/defaults. Consumed by
  the engine, the backend, and the UI (Phase 3).
- **`@ecp/engine`** — the pure, dependency-free capacity/feasibility engine.
  Projects a dev-complete date and returns a red/yellow/green verdict. No DB,
  no UI, no runtime dependencies beyond `@ecp/shared` types/helpers.
- **`@ecp/backend`** — Node + TypeScript. SQLite via `better-sqlite3`, a
  minimal Fastify API, and the `SyntheticImporter`. Tests run on
  [Vitest](https://vitest.dev).
- **`@ecp/frontend`** — React + TypeScript + Vite. The Calendar/Timeline tab.
  Runs the pure engine in the browser for instant what-if recompute. Logic
  tested with Vitest, driven end-to-end with [Playwright](https://playwright.dev).

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

## What Phase 2 delivers

The **capacity / feasibility engine** (`packages/engine`) — a pure,
dependency-free module, the highest-value part of the app.

- **Projection** — walks forward one working day at a time from `today`,
  accumulating each day's team throughput until the remaining points are
  covered, to produce a **projected dev-complete date**.
- **Capacity model** — a member's per-sprint velocity is spread across the
  sprint's working days and scaled by availability: `0` on PTO, the on-call
  multiplier when on call, and any velocity-override multiplier — composed
  multiplicatively. Inactive members contribute nothing. A partial
  (already-underway) sprint only contributes its remaining days.
- **Verdict** — `buffer = workingDaysBetween(devComplete, gatingDate)`, then
  **green** (buffer ≥ `green_min_buffer_days`), **yellow** (`0 ≤ buffer <
  green_min`), **red** (buffer `< 0`, or the work can't finish within the
  horizon), each with a human-readable reason.
- **Configurable** — sprint cadence, on-call multiplier, and the buffer
  thresholds are all inputs; nothing is hard-coded.
- **Pure & exhaustively tested** — no DB, no UI, no I/O. Given identical inputs
  it returns an identical result, covering green/yellow/red edges, buffer sign,
  PTO/on-call/override effects, cadence differences, cut-ticket recalculation,
  and the infeasible case.

```ts
import { project } from '@ecp/engine';

const result = project({
  today: '2026-01-06',
  team,               // cadence + working days
  members, pto, oncall, velocityOverrides,
  workItems,          // remaining points derived from statuses
  gatingDate: '2026-03-02',
  config: { greenMinBufferDays: 5, oncallMultiplier: 0.5 },
});
// → { projectedDevCompleteDate, bufferWorkingDays, verdict, reason, sprints }
```

`projectEpicFromDataset(dataset, epicKey, today)` is a thin bridge that pulls
the epic's team, gating milestone, work items, and settings out of a full
`DomainDataset` and calls the pure core.

## What Phase 3 delivers

The **Calendar / Timeline tab** (`packages/frontend`) — the colored timeline
that answers the core question at a glance (project plan §6).

- **Status strip** — a green/yellow/red banner with the verdict ("On track" /
  "At risk" / "Off track"), the engine's reasoning, and headline metrics
  (projected dev-complete, buffer in working days, points remaining).
- **Timeline** — a horizontal axis with a **today** marker, a marker for each
  of the epic's relevant days (the **gating** one highlighted), the
  **dev-complete** marker colored by verdict, a buffer band between
  dev-complete and the gating day, month ticks, and per-sprint capacity bands.
- **Live recompute** — editing `today`, the green buffer threshold, or the
  on-call multiplier, and **cutting a ticket** or **marking it done**, re-runs
  the projection instantly. The pure `@ecp/engine` runs **in the browser**, so
  what-if changes are immediate with no round-trip.
- **Data** — the UI fetches the dataset from the backend API
  (`GET /api/dataset`) and **falls back to a bundled synthetic sample** when the
  backend isn't running (so it also runs with zero setup and is e2e-testable
  standalone). A small indicator shows which source is live. In dev, Vite
  proxies `/api` to the backend, so the browser fetches same-origin.

```bash
npm run dev              # backend (Fastify :3001) + frontend (Vite :5173) together
# → open http://localhost:5173 ; the header shows "● Live data from backend API"

npm run dev:frontend     # frontend only (uses the bundled sample fallback)
npm run export:fixture   # regenerate the bundled fallback dataset
npm run e2e              # Playwright e2e (drives the timeline in Chromium)
```

The backend seeds an empty database with synthetic data on startup, so
`npm run dev` needs no separate seed step.

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
  shared/     @ecp/shared  — domain types, importer interface, date helpers, settings defaults
  engine/     @ecp/engine  — pure capacity engine (projection + verdict)
    src/        calendar.ts, capacity.ts, project.ts, adapter.ts, config.ts
    test/       vitest suites (calendar, capacity, project, adapter)
  backend/    @ecp/backend — SQLite schema/persistence, SyntheticImporter, API
    src/
      db/         schema.ts, database.ts, persist.ts
      importer/   rng.ts, synthetic.ts
      scripts/    seed.ts, export-fixture.ts
      server.ts
    test/       vitest suites
  frontend/   @ecp/frontend — React + Vite Calendar/Timeline tab
    src/
      components/ StatusStrip, Timeline, Controls, WorkItemList
      lib/        projection.ts, timeline.ts, format.ts
      data/       loadDataset.ts, fixtures/dataset.json
    test/       vitest logic suites
    e2e/        playwright specs
docs/         project plan
```

## Conventions

- Dates are ISO `YYYY-MM-DD` strings; weekdays use `Date.getUTCDay()` (0 = Sun).
- The synthetic generator is fully deterministic per seed, so tests assert on
  exact output.
- The SQLite file is the shareable unit and is gitignored — regenerate it with
  `npm run seed`.

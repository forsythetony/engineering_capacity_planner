# Engineering Capacity Planner

# Overview

A local, single-user sprint-planning tool that answers one question well:
**"Given today's date and the work remaining, are our promised QA / testing /
launch dates still realistic?"**

It pulls epic/story data into a local SQLite database, layers on team-capacity
inputs (per-member velocity, PTO, on-call), and renders a **red/yellow/green**
timeline against each epic's gating "relevant day." It runs entirely on your
machine; the SQLite file is the shareable unit.

**Why it's useful:** Jira tracks tickets but doesn't reason about your team's
actual capacity over calendar time. This tool does the math Jira won't —
remaining points ÷ realistic capacity (adjusted for PTO, on-call drag, and
per-person velocity) projected against real dates.

**Architecture** — a monorepo of small packages, everything behind a
**pluggable importer interface** so a real Jira adapter can drop in later
without touching the engine or UI:

- **`@ecp/shared`** — domain model, the importer contract, pure date/calendar
  helpers, and configurable settings/defaults.
- **`@ecp/engine`** — the pure, dependency-free capacity/feasibility engine.
  Projects a dev-complete date and returns the red/yellow/green verdict. No DB,
  no UI, no I/O.
- **`@ecp/backend`** — Node + TypeScript. SQLite via `better-sqlite3`, a minimal
  Fastify API, and the importers (synthetic now, Jira later).
- **`@ecp/frontend`** — React + TypeScript + Vite. The Calendar/Timeline tab;
  runs the engine in the browser for instant what-if recompute.

Tooling: [Vitest](https://vitest.dev) for unit tests,
[Playwright](https://playwright.dev) for e2e. Requires **Node ≥ 20** (developed
on 22; see `.nvmrc`).

# Getting Started

## Configuration Setup

Nothing environment-specific is hardcoded. All config comes from environment
variables, and a single `.env` at the repo root serves both the backend and the
Vite frontend. Copy the template and edit:

```bash
cp .env.example .env
```

An empty `.env` runs the app on synthetic data. Key knobs:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ECP_HOST` / `ECP_PORT` | `127.0.0.1` / `3001` | API bind address |
| `ECP_DB_PATH` | `./data/ecp.db` | SQLite file (the shareable unit) |
| `ECP_CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for the API |
| `ECP_DATA_SOURCE` | `synthetic` | `synthetic` or `jira` |
| `ECP_SEED_IF_EMPTY` | `true` | Import from the source if the DB is empty on startup |
| `ECP_SYNTHETIC_SEED` | `1` | Deterministic seed for the synthetic generator |
| `VITE_PORT` / `VITE_API_TARGET` | `5173` / `http://127.0.0.1:3001` | Dev server + proxy target |
| `JIRA_*` | — | Jira connection + mapping (used when `ECP_DATA_SOURCE=jira`) |

**Pointing at Jira** (importer lands in Phase 7): set `ECP_DATA_SOURCE=jira` and
fill the `JIRA_*` values (base URL, email, API token, project key, story-points
field, "blocks" link type). The importer is selected by config alone — no code
change — and fails fast listing the exact missing variables until Phase 7 lands
its `fetch()`.

**Security:** the SQLite database is the shareable unit, so **secrets never
touch it**. The Jira API token lives only in the environment / `.env` (which is
gitignored).

## Installing Dependencies

```bash
nvm use              # optional — selects Node 22 from .nvmrc
npm install          # installs all workspaces (builds the better-sqlite3 native addon)
```

## Running the App

```bash
npm run dev          # backend (Fastify :3001) + frontend (Vite :5173) together
# → open http://localhost:5173 ; the header shows "● Live data from backend API"
```

The backend imports from the configured source into an empty database on
startup, so `npm run dev` needs no separate seed step. Other entry points:

```bash
npm run dev:backend    # backend only
npm run dev:frontend   # frontend only (falls back to the bundled sample dataset)
npm run build          # type-check + emit all packages
curl http://127.0.0.1:3001/api/summary   # quick backend sanity check
```

## Testing

```bash
npm test             # all Vitest suites (shared, engine, backend, frontend)
npm run typecheck    # type-check without emitting
npm run e2e          # Playwright e2e (drives the timeline in Chromium)
```

In sandboxes where Playwright's own browser build isn't present, point it at a
preinstalled Chromium: `PW_CHROMIUM_PATH=/path/to/chrome npm run e2e`.

## Seeding & Inspecting the Database

`npm run dev` auto-populates an empty DB. To generate and inspect the **local**
database directly (Phase 1 is verifiable via DB inspection):

```bash
npm run seed:local             # → ./data/ecp.db
npm run export:fixture         # regenerate the frontend's bundled fallback dataset

# Parameterized runs (different seed / size / path) pass flags to the script,
# so invoke it from the backend workspace where `--` forwards cleanly:
npm run seed:local -w @ecp/backend -- --seed 7 --items 60
```

> `seed:local` seeds this machine's SQLite file. Its Phase 7 counterpart,
> `seed:jira`, pushes the same synthetic dataset into a real Jira instance so the
> sync round-trip can be exercised end-to-end.

Example `npm run seed:local` output:

```
Seeded synthetic dataset → ./data/ecp.db (seed=1)

  Teams:        1
  Members:      5 (4 active)
  Epic:         CKT — Checkout Revamp
  Stories:      10
  Work items:   50  (188 points)
  Dependencies: 38
  Status mix:   {"In Review":10,"Done":12,"In Progress":7,"To Do":21}
  Gating day:   First QA in stage pass @ 2026-07-28
  Top blockers (transitive dependents):
    CKT-2    blocks 16  — Document currency formatting
    CKT-1    blocks 10  — Fix analytics events
    ...
```

## Jira Synchronization (Phase 7)

The app can pull its data from a real Jira project instead of the synthetic
generator. **Jira owns facts** (epics, stories, work items, points, status,
labels, dependencies, sprints); **the local database owns intent** (PTO,
on-call, velocity, milestones, knobs, and the Gantt placements). A **Sync**
re-imports the facts and reconciles them onto local state without losing your
plan — completed tickets are auto-pulled from their future week, freeing
capacity.

**Credentials** (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`) live in the
environment only, never in the database. **Field mapping** (which custom field
is story points, the sprint field, the "blocks" link type, …) is set in the app
— Configuration → Jira mapping resolves it from a live sample of your board —
and persisted to the database.

Prove the loop end-to-end against a real instance:

```bash
# 1. Push the synthetic dataset INTO your Jira (creates an epic + its subtree):
npm run seed:jira -w @ecp/backend -- --no-assignee     # prints the new epic key
# 2. Point the app at it and pull it back:
#    set ECP_DATA_SOURCE=jira + the JIRA_* mapping in .env, then:
npm run dev                                             # hit Sync in the UI

# No Jira handy? Run the whole push against an in-memory fake:
npm run seed:jira -w @ecp/backend -- --fake
```

The client targets the current Jira Cloud REST v3 + Agile APIs (cursor-paginated
`search/jql`, the standard `parent` field, workflow transitions for status). An
in-memory `FakeJiraClient` mirrors those exact shapes, so the full
push → sync → reconcile round-trip is covered headlessly in the test suite.

## Project Layout

```
packages/
  shared/     @ecp/shared  — domain types, importer interface, date helpers, settings defaults
  engine/     @ecp/engine  — pure capacity engine (projection + verdict)
    src/        calendar.ts, capacity.ts, project.ts, adapter.ts, config.ts
    test/       vitest suites (calendar, capacity, project, adapter)
  backend/    @ecp/backend — config, SQLite schema/persistence, importers, API
    src/
      config.ts   env-driven configuration
      db/         schema.ts, database.ts, persist.ts
      importer/   rng.ts, synthetic.ts, jira.ts, factory.ts
      scripts/    seed.ts, export-fixture.ts
      server.ts
    test/       vitest suites
  frontend/   @ecp/frontend — React + Vite Calendar/Timeline tab
    src/
      components/ StatusStrip, Timeline, WorkItemList
      lib/        projection.ts, timeline.ts, format.ts
      data/       loadDataset.ts, fixtures/dataset.json
    test/       vitest logic suites
    e2e/        playwright specs
docs/         project plan
.env.example  every configurable knob
```

## Conventions

- Dates are ISO `YYYY-MM-DD` strings; weekdays use `Date.getUTCDay()` (0 = Sun).
- The synthetic generator is fully deterministic per seed, so tests assert on
  exact output.
- The SQLite file is the shareable unit and is gitignored — regenerate it with
  `npm run seed:local` (or let the server auto-import on startup).

# Project Planning

The full spec lives in
[`docs/sprint-planning-tool-project-plan.md`](docs/sprint-planning-tool-project-plan.md).
This section tracks status and notes as we go.

## Roadmap

**Milestone 1 (Phases 1–3)** proved the core hypothesis — synthetic data →
capacity engine → colored timeline — built as independently reviewable PRs.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **1** | Data model + synthetic importer | ✅ merged |
| **2** | Capacity engine + exhaustive unit tests | ✅ merged |
| **3** | Calendar / timeline UI (red/yellow/green) | ✅ merged |
| — | Live API wiring + full config/portability | 🔍 in review |
| **4** | Dependency graph UI (DAG, high-leverage highlighting) | ⏭️ next |
| **5** | Configuration UI (knobs dashboard) + write endpoints | ⏳ planned |
| **6** | Export / import of the database file | ⏳ planned |
| **7** | Jira importer (implements the seam already in place) | ⏳ planned |
| **8** | Polish & packaging (e2e hardening, optional Tauri/Electron) | ⏳ planned |

## Delivered so far

- **Domain + persistence** — schema for teams/cadence, roster, PTO, on-call,
  velocity overrides, epics, "relevant day" milestones (exactly one gating),
  stories, work items, dependencies, and a settings store. FK-enforced,
  transactional, lossless round-trip.
- **Synthetic importer** — deterministic, seedable ~50-item epic with varied
  points/statuses/assignees and a DAG dependency web including high-leverage
  blockers.
- **Capacity engine** — day-by-day projection to a dev-complete date; capacity
  scaled by PTO/on-call/velocity-override (composed multiplicatively);
  `buffer = workingDaysBetween(devComplete, gatingDate)` → green/yellow/red with
  a reason. Pure and exhaustively unit-tested.
- **Timeline UI** — status strip + horizontal timeline (today, relevant-day
  markers, verdict-colored dev-complete, buffer band, sprint capacity bands),
  recomputing live on edits and ticket cuts, with the engine running in-browser.
- **Plumbing + config** — UI loads from the live backend API (bundled-sample
  fallback); everything env-driven behind one root `.env`; importer selected by
  config with a Jira seam ready for Phase 7.

## Notes & open questions

- **Read-only API today.** Editing capacity inputs (members, PTO, on-call,
  thresholds, relevant days) needs write endpoints — planned with the Phase 5
  config dashboard.
- **Single-epic view.** The timeline shows `epics[0]`; multi-epic selection can
  become config/UI once a real Jira project brings several.
- **Modeling choice:** any non-`Done` work item counts as fully remaining (no
  partial-progress fraction yet). Velocity is per **sprint**, so sprint length
  affects daily throughput — faithful to the spec's unit.
- **No CI** — this repo is destined for an internal work environment, so GitHub
  Actions is intentionally omitted.
- **Demo scenario dates** — the synthetic data plans as of **Sun Jul 12, 2026**
  toward a gating target of **Tue Jul 28, 2026** (the importer's `today` /
  `gatingDate`). Dates render as `Sun Jul 12, 2026` throughout. Real data uses
  the actual current date.

## Resuming work (fresh session / handoff)

This README is the handoff. To pick up where the last session left off, read, in
order: **this Project Planning section** (roadmap + what's delivered + notes),
[`docs/sprint-planning-tool-project-plan.md`](docs/sprint-planning-tool-project-plan.md)
(the full spec), and the **git log / merged PRs** (each phase is one PR).

Working agreement used so far:

- **One reviewable PR per phase**, built on a feature branch off `main`.
- After a PR merges, **restart the branch from the latest `main`** for the next
  phase (don't stack on merged history).
- **Verify before every PR:** `npm run build && npm run typecheck && npm test`,
  plus `npm run e2e` for UI changes, and a screenshot of any new UI.
- Keep everything **config-driven** — no hardcoded ports, paths, dates, or
  credentials (see Configuration Setup).

**Next up: Phase 4 — the dependency graph UI** (left-to-right DAG of tickets,
edges = "blocked by", high-leverage blockers highlighted via transitive-dependent
count). The dependency data and the leverage ranking already exist (see the
synthetic importer and the `seed` script's "Top blockers" output).

_Add planning notes here as they come up and reference them from PRs/commits._

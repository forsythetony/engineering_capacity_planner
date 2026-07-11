# Sprint Planning Tool — Project Plan (Draft v2, for Validation)

*Purpose: turn the brainstorm into something you can review, correct, and approve before any code is written. Nothing here is built yet. Section 10 tracks what's decided vs still open.*

*Changes in v2: sprint cadence, on-call impact, and green/yellow/red thresholds are now first-class **configurable** settings (per team where it matters); epics carry configurable "relevant days" with one flagged as the gating milestone; Jira is deferred behind a mapping layer and we build on synthetic data only for now.*

---

## 1. What we're building (in one paragraph)

A local, single-user desktop-style web app that pulls epic/story data into a local SQLite database, layers on team-capacity inputs (per-member velocity, PTO, on-call), and answers one question well: **"Given today's date and the work remaining, are our promised QA / testing / launch dates still realistic?"** It shows the answer as a red/yellow/green timeline, lets you model "what if we cut this ticket" changes, and includes a dependency graph so the team always works the tickets that unblock the most downstream work. It runs entirely on each user's machine; sharing happens by exporting and passing around a database/export file.

---

## 2. Core value (why Jira alone isn't enough)

Jira tracks tickets but doesn't reason about *your team's actual capacity over calendar time*. This tool's job is the math Jira won't do: remaining points ÷ realistic capacity (adjusted for PTO, on-call drag, and per-person velocity) projected against real dates, plus the dependency-ordering insight that tells you which ticket to pick up next.

---

## 3. Architecture

**Backend language.** Recommendation: **Node + TypeScript end-to-end** so the whole codebase is one language and the capacity-math types are shared between frontend and backend. (Say the word if you'd prefer Python/FastAPI.)

Proposed stack:

- **Frontend:** React + TypeScript, built with Vite. Tailwind for styling. React Flow (dagre layout) for the dependency graph. A lightweight timeline layer for the calendar view.
- **Backend:** Fastify + TypeScript, serving a small REST API on localhost.
- **Database:** SQLite via `better-sqlite3`, stored as a single file. This *is* the shareable unit.
- **Data source:** a pluggable importer interface (see §7). A **synthetic generator** implements it now; a Jira adapter can implement it later without touching the engine or UI.
- **Packaging (later):** run locally via `npm start`, optionally wrapped in Tauri/Electron for a double-click app. Deferred.

"Client-side" here means "runs on your machine," not "browser-only." SQLite and any future sync need a local process with filesystem/network access — that's the Node backend. Nothing is hosted or multi-tenant.

```
Importer (synthetic now │ Jira later)  ──▶  Node backend  ──▶  SQLite file
                                              │                   ▲
                                              ▼                   │ export / import
                                         REST API  ◀──▶  React UI (Calendar | Dependencies | Config)
```

---

## 4. Data model (first cut)

**Teams & cadence (configurable, per team)**

- **team** — id, name, sprint_length_days (**default 14**), sprint_start_weekday (**default Tuesday**), sprint_anchor_date (a known real sprint start, so we can compute all past/future sprint boundaries), working_days (**default Mon–Fri**). Different teams can have different cadences.
- **team_member** — id, team_id, name, base_velocity (points/sprint), active.
- **velocity_override** — member_id, date_range, value or multiplier (ramping hire, reduced week).
- **pto** — member_id, start_date, end_date.
- **oncall** — member_id, date_range. Impact is driven by a **configurable multiplier** (see settings) rather than hard-coded.

**Work hierarchy**

- **epic** — key, title, team_id.
- **epic_milestone ("relevant days")** — epic_key, name (e.g., "First QA in stage pass", "Launch"), date, is_gating (bool). Fully configurable list; exactly one is flagged `is_gating` and drives the color verdict (see §5).
- **user_story** — key, epic_key, title (the grouping layer).
- **work_item** — key, story_key, title, points, status, assignee_id.
- **dependency** — blocker_item_key, blocked_item_key.

**Settings (the configurable "knobs" dashboard)**

- **settings** — key/value store for global + per-team + per-epic overrides, including:
  - on-call impact multiplier (e.g., 0.5 = an on-call day yields half that person's normal output),
  - green/yellow/red buffer thresholds in days (see §5),
  - future Jira mapping fields (see §7), inert until the Jira phase.

---

## 5. The capacity / feasibility engine (the heart of the app)

A pure, well-tested module. Inputs: remaining work items + points, the team's sprint calendar (derived from cadence config), roster, PTO, on-call, velocity overrides. Output: a **projected dev-complete date** for the epic, plus a red/yellow/green verdict and its reasoning ("you're 6 points over what this sprint can absorb").

**How the color works (per your spec).** Each epic has a **gating "relevant day"** — e.g., *first QA-in-stage pass for the whole epic*. The engine computes **buffer = gating_date − projected_dev_complete_date** (in working days). Two configurable thresholds decide the band:

- **Green** — buffer ≥ `green_min_buffer_days` (comfortable slack before the gating day).
- **Yellow** — `0 ≤ buffer < green_min_buffer_days` (we finish in time but eat into the buffer we wanted).
- **Red** — buffer < `0` (projected dev-complete lands *after* the gating day — the math doesn't work).

Thresholds and the gating date are configurable, so each epic/team can tune what "safe" means. Because the module has **no UI and no database dependency**, it's unit-tested exhaustively with synthetic inputs. It's where correctness matters most, so it's built and tested before any pixels.

---

## 6. Feature areas → UI tabs

**Calendar / Timeline tab** — horizontal timeline with a "today" marker and markers for the epic's relevant days. A status strip renders green/yellow/red based on projected dev-complete vs the gating day. Editing inputs or cutting a ticket re-runs the projection live so you can see whether a change moves you back into green.

**Dependencies tab** — left-to-right flowchart of tickets, edges = "blocked by." Color-coding highlights high-leverage blockers (a ticket that, once done, unblocks many others). Computed via a DAG + transitive-dependent count.

**Configuration tab** — the knobs dashboard. CRUD for teams & cadence, members, velocity overrides, PTO, on-call; plus the tunable settings (on-call multiplier, buffer thresholds) and each epic's relevant days. Also export/import of the database file.

---

## 7. Data strategy: synthetic now, Jira-ready by design

We build on a **synthetic data generator only** for now — no live Jira in the loop. But we deliberately carve out a **mapping/adapter layer** so swapping in Jira later is a drop-in, and so we can iterate fast on UX flow in the meantime:

- **Domain model** (the tables in §4) is the app's source of truth; nothing in the engine/UI knows where data came from.
- **Importer interface** — a single contract like `fetchEpic(): DomainEpic` with `{ epics, stories, work_items, dependencies }`.
- **SyntheticImporter** (built now) — generates an epic of ~50 work items grouped under user stories, varied point sizes/statuses/assignees, and a realistic dependency web (including a few high-leverage blockers). This is what drives all development and testing.
- **Field-mapping settings (stubbed now)** — reserved config for the eventual Jira mapping: Jira flavor (Cloud vs Server/Data Center), the story-points custom field, target project key, and the issue-link type that represents "blocks." These live in the settings table and the UI from early on (even if inert), so the mapping UX is designed alongside everything else rather than bolted on.
- **JiraImporter (future phase)** — implements the same interface using those settings. The engine, timeline, and graph need zero changes when it lands.

Net effect: we get an easy, fully local test loop today, and a clean seam to plug real Jira into later — with the mapping already a designed part of the UX.

---

## 8. Testing / self-validation strategy (my inner loop)

- **Unit tests** on the capacity engine — many synthetic scenarios covering green/yellow/red edges, buffer thresholds, PTO overlaps, on-call multiplier, cadence differences between teams, and cut-ticket recalculations.
- **Graph tests** — topological correctness, cycle detection, high-leverage-blocker ranking.
- **API/integration tests** — importer writes correct rows; export/import round-trips losslessly.
- **Playwright e2e** — stand up the app on synthetic data, drive each tab, assert the timeline turns the right color and screenshots look right.
- **Verification pass** — I stand the app up headless, inspect output, and confirm against expected numbers before reporting a phase done.

---

## 9. Phased build (each phase independently reviewable)

- **Phase 0 — Scaffolding.** Repo, backend, frontend, SQLite, test harness, settings store.
- **Phase 1 — Data model + synthetic importer.** Schema + generator producing the ~50-item epic behind the importer interface. Verifiable via DB inspection.
- **Phase 2 — Capacity engine + tests.** The core math (dev-complete projection, buffer, color verdict), fully unit-tested. *Highest-value phase.*
- **Phase 3 — Calendar/timeline UI.** Red/yellow/green vs the gating relevant-day; live recompute on edits/cuts.
- **Phase 4 — Dependency graph UI.** DAG, left-to-right layout, high-leverage highlighting.
- **Phase 5 — Configuration UI (knobs dashboard).** Teams/cadence, members, PTO, on-call, velocity, thresholds, relevant days, mapping stubs.
- **Phase 6 — Export/import.** Shareable DB/export files.
- **Phase 7 — Jira importer.** Implement the interface against real Jira using the mapping settings; setup/teardown scripts for your environment.
- **Phase 8 — Polish & packaging.** e2e hardening, optional Tauri/Electron wrapper.

Suggested first milestone: **Phases 1–3** (synthetic data → engine → colored timeline) to prove the core hypothesis before investing in the graph, config surface, and Jira.

---

## 10. Decisions

**Resolved (this round)**

1. Sprint cadence is **configurable per team**; default **2-week sprints starting Tuesday, Mon–Fri working days**.
2. Velocity unit = **points per person per sprint**. ✔
3. On-call impact = a **configurable multiplier**.
4. Color logic = buffer in days between **projected dev-complete** and the epic's **gating "relevant day"** (e.g., first QA-in-stage pass); **green/yellow/red thresholds and the relevant days are all configurable**.
5. Data source = **synthetic generator only** for now, behind a mapping/importer layer; Jira deferred.
6. Jira specifics (flavor, story-point field, project key, "blocks" link type) = **configurable settings**, designed in early but inert until Phase 7.

**Still open**

- Backend language: **Node/TS (recommended)** vs Python/FastAPI — confirm.
- First milestone scope: is **Phases 1–3** the right first thing to build?

---

## 11. How you'll work with me on this (cloud / no-laptop setup)

The goal is a loop where I build and self-test on a cloud machine, and you validate/steer from a browser or phone without opening your laptop. See the chat message accompanying this doc for the full walkthrough of the recommended setup (GitHub repo + Claude Code on the web, with PR review as the steering mechanism).
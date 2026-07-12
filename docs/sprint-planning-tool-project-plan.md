# Sprint Planning Tool — Project Plan (Draft v3, for Validation)

*Purpose: turn the brainstorm into something you can review, correct, and approve. Phases 1–5 are built (synthetic data → engine → timeline → dependency graph → configuration); the roadmap below now centers on the two remaining big items. Section 10 tracks what's decided vs still open.*

*Changes in v3: the roadmap is reworked around the two next big items — the **Gantt Planner** (Phase 6, the crux of the tool) and **Jira synchronization** (Phase 7, expanded from a one-way importer into a resilient bidirectional sync). Export/import and packaging are demoted to Phase 8. The data model gains label-driven lanes, first-class synced sprints, and human-authored "planned placements" designed to survive syncs.*

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
- **work_item** — key, story_key, title, points, status, assignee_id, **labels[]**. Labels are the source for the Gantt Planner's horizontal lanes (e.g. "Navigation", "Prescriptions Tab"); a lane's total is the sum of points of the items carrying that label.
- **dependency** — blocker_item_key, blocked_item_key.

**Sprints & planning (drives the Gantt Planner, §6a)**

- **sprint** — id, team_id, name, start_date, end_date. Today sprint boundaries are *derived* from cadence math; the Gantt needs sprints as **first-class stored entities** (the sprint dropdown), synced from Jira in Phase 7. Each sprint subdivides into 7-day **weeks** aligned to its start.
- **planned_placement** — work_item_key, sprint_id, week_index. The **human-authored** output of the planning exercise: which week a piece of work is slotted into. Stored *separately* from Jira-sourced fields so it **survives syncs** — Jira owns facts (status, points, existence); placements own intent. On sync, a work item that returns `Done` is auto-pulled from its future slot, freeing that week's capacity.
- **lane_config** — epic_key, ordered list of labels to surface as lanes (and which to hide/merge). Keeps the board's rows intentional rather than "one row per stray label."

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

### 6a. Gantt Planner tab (Phase 6 — the crux)

This is the feature the tool exists to produce, and the thing Jira doesn't do: the week-by-week capacity-fitting exercise, done by the computer instead of by hand in Excel. It **zooms into a sprint** and breaks it out week by week.

- **Sprint selector** (top-left) picks the sprint; sprints are synced from Jira (Phase 7).
- **Week columns** — one column per 7-day week, aligned to the sprint start. A 2-week sprint = 2 columns.
- **Backlog "bag"** — an embedded list of the sprint's work that is *unstarted, unassigned, and unreserved*: things we have to do but haven't slotted yet. You drag items out of the bag into a week; the week determines the sprint placement.
- **Green/yellow/red per week** — each week column's verdict compares `points placed that week` against `that week's computed capacity` (velocity − PTO − on-call drag). This mirrors the Excel "Weekly Total LOE vs Weekly Available Capacity" rows exactly. Overload a week → it goes red → drag something into the next week → both recompute live.
- **Horizontal lanes** — the epic's subdivisions, sourced from work-item **labels** (Navigation, Prescriptions Tab, …), each showing its rolled-up point total. *(Second axis; see build order below.)*
- **Engineer strip** — avatars along the bottom; click one to open a modal with that person's week-by-week capacity as an indented sublist, including PTO / on-call / velocity-override call-outs.
- **Survives syncs** — placements are the artifact the whole tool is built around, so they persist across Jira refreshes (see `planned_placement`, §4).

**Color granularity (decided):** the capacity color lives at the **week (column) level only** — capacity is a shared pool, so it has no meaning per individual `(lane × week)` cell. Cells stay neutral for capacity. *(Open: whether cells should later carry a **different** signal — e.g. "assignee on PTO this week" or "an upstream dependency isn't Done" — in a distinct hue.)*

**Build order — lean first (Option B → A).** Ship the single-axis loop first: sprint dropdown + week columns + the bag + per-week G/Y/R + the engineer modal, with labels shown as pills on each chip and a "group by label" toggle. Only once that drag → recolor → spill-to-next-week loop feels right do we commit to the full two-axis grid (dedicated lane rows). An engine-led **auto-fit** first pass (greedily pack the backlog by capacity, respecting dependencies and reservations, then nudge) is a later enhancement layered on top — not part of the first increment.

---

## 7. Data strategy: synthetic now, Jira-ready by design

We build on a **synthetic data generator only** for now — no live Jira in the loop. But we deliberately carve out a **mapping/adapter layer** so swapping in Jira later is a drop-in, and so we can iterate fast on UX flow in the meantime:

- **Domain model** (the tables in §4) is the app's source of truth; nothing in the engine/UI knows where data came from.
- **Importer interface** — a single contract like `fetchEpic(): DomainEpic` with `{ epics, stories, work_items, dependencies }`.
- **SyntheticImporter** (built now) — generates an epic of ~50 work items grouped under user stories, varied point sizes/statuses/assignees, and a realistic dependency web (including a few high-leverage blockers). This is what drives all development and testing.
- **Field-mapping settings (stubbed now)** — reserved config for the eventual Jira mapping: Jira flavor (Cloud vs Server/Data Center), the story-points custom field, target project key, and the issue-link type that represents "blocks." These live in the settings table and the UI from early on (even if inert), so the mapping UX is designed alongside everything else rather than bolted on.
- **JiraImporter (Phase 7)** — implements the same interface using those settings. The engine, timeline, and graph need zero changes when it lands.

Net effect: we get an easy, fully local test loop today, and a clean seam to plug real Jira into later — with the mapping already a designed part of the UX.

**Phase 7 goes further than a one-way importer — it's a synchronization round-trip:**

- **Seed test data into Jira** — a script that pushes our synthetic dataset *into* a real Jira instance, so we can prove the loop end-to-end against a live server rather than a fixture.
- **Sync back and reconcile** — pull the same data out through the importer and reconcile it against local state, honoring the `planned_placement` intent layer (facts from Jira, intent stays local; completed tickets auto-pulled from future slots).
- **Resilient, configurable field mapping** — the tool works with whatever fields a team *already has*. Story-points field, the labels that feed lanes, the sprint field, and the "blocks" link type are all mapped via settings, not hard-coded. The core value survives even when a team's Jira doesn't look exactly like ours — they map what they have and it works.

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
- **Phase 6 — Gantt Planner.** *(next — the crux of the tool; see §6a.)* The week-by-week allocation board: sprint selector, week columns, a backlog "bag" of unreserved work you drag into weeks, per-week green/yellow/red capacity, epic subdivisions as label-driven horizontal lanes, and an engineer strip that opens a per-person capacity breakdown. Built **lean-first** (Option B): the single-axis week/capacity/drag loop before the full two-axis grid. Introduces label-driven lanes, first-class stored sprints, and human-authored `planned_placement`s designed to survive later syncs.
- **Phase 7 — Jira synchronization.** *(see §7.)* Implement the importer against real Jira and go bidirectional: seed a Jira instance with test data, sync it back, and reconcile against the local intent layer. Field mapping is **resilient and configurable** — the tool works with whatever fields a team already has (story-points, labels, sprint, "blocks" link type) rather than requiring an exact shape. Jira owns facts; the Gantt's placements own intent; a completed ticket is auto-pulled from its future slot, freeing that week's capacity.
- **Phase 8 — Export/import, polish & packaging.** Shareable DB/export files, e2e hardening, optional Tauri/Electron wrapper.

**Status:** Phases 1–7 are complete (synthetic data → engine → timeline → dependency graph → configuration → Gantt Planner → Jira synchronization). Phase 7 landed the round-trip against the current Jira Cloud REST v3 + Agile APIs, behind a `JiraClient` seam with an in-memory `FakeJiraClient` that mirrors the wire shapes so the whole push → sync → reconcile loop runs headless. Facts (epics/stories/work items/deps/sprints) come from Jira; intent (PTO, on-call, velocity, milestones, knobs, Gantt placements) stays local and survives syncs, with completed tickets auto-pulled from their slots. Field mapping is resolved live from a sample issue in the Configuration tab and persisted to settings. `seed:jira` pushes the synthetic dataset into a real (or fake, via `--fake` / `ECP_JIRA_FAKE=true`) instance. The next milestone is **Phase 8 (export/import, polish & packaging)**.

---

## 10. Decisions

**Resolved (this round)**

1. Sprint cadence is **configurable per team**; default **2-week sprints starting Tuesday, Mon–Fri working days**.
2. Velocity unit = **points per person per sprint**. ✔
3. On-call impact = a **configurable multiplier**.
4. Color logic = buffer in days between **projected dev-complete** and the epic's **gating "relevant day"** (e.g., first QA-in-stage pass); **green/yellow/red thresholds and the relevant days are all configurable**.
5. Data source = **synthetic generator only** for now, behind a mapping/importer layer; Jira deferred.
6. Jira specifics (flavor, story-point field, project key, "blocks" link type) = **configurable settings**, designed in early but inert until Phase 7.
7. Next milestone = **Gantt Planner** (Phase 6), built **lean-first** (single-axis week/capacity/drag loop) toward the full two-axis board; then **Jira synchronization** (Phase 7).
8. Gantt capacity color = **week-level only** (placed points vs weekly capacity), mirroring the Excel "Weekly Total LOE vs Weekly Available Capacity" rows. Per-cell color is *not* used for capacity.
9. Backend language confirmed **Node/TS** (Phases 1–5 shipped on it).

**Still open**

- Whether Gantt `(lane × week)` cells should later carry a **non-capacity** signal (assignee on PTO that week / upstream dependency not Done) in a distinct hue.

**Resolved in Phase 7**

- Sprint sync mechanics: sprints and their date ranges are read from the **Agile board API** (`GET /rest/agile/1.0/board/{id}/sprint`), with the board auto-discovered from the project (overridable via `jira_board_id`). The Jira datetime is trimmed to a calendar date for the Gantt's week columns.
- Hierarchy mapping: epic → stories → work items is read by **parent-chain depth**, not issue-type names, so it works across team- and company-managed projects.
- Status fidelity on the seed path is applied via **workflow transitions** (Jira can't set status on create); assignees need real accountIds on live Jira (`--no-assignee` otherwise).

---

## 11. How you'll work with me on this (cloud / no-laptop setup)

The goal is a loop where I build and self-test on a cloud machine, and you validate/steer from a browser or phone without opening your laptop. See the chat message accompanying this doc for the full walkthrough of the recommended setup (GitHub repo + Claude Code on the web, with PR review as the steering mechanism).
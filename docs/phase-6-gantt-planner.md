# Phase 6 — Gantt Planner (implementation spec)

*Status: in progress. This spec is the agreed design; it turns the roadmap
entry (project plan §6a) into a concrete, staged build.*

## What it is

The week-by-week capacity-fitting exercise, done by the computer instead of by
hand in Excel. It **zooms into a sprint** and breaks it out week by week: you
drag work out of a backlog "bag" into weeks, and each week lights up
green/yellow/red by how loaded it is against the team's real capacity (velocity
− PTO − on-call − ramping overrides).

The reference is the team's current Excel Gantt: subdivisions (from labels) down
the left, weeks across the top, a "Weekly Total LOE vs Weekly Available
Capacity" comparison driving the color.

## Locked decisions

1. **Color is week-level only.** Capacity is a shared pool, so it has meaning
   per *week column*, not per `(lane × week)` cell. Cells stay neutral.
2. **Yellow threshold is a tunable knob**, `week_yellow_load_fraction`, editable
   in the Configuration tab. **Default 1.0**: a week is *green* below capacity,
   *yellow* exactly at/above full capacity ("no room to breathe, but doable"),
   *red* over capacity. Lowering the knob (e.g. 0.9) widens the yellow warning
   band.
3. **Sprints are first-class stored entities** now (not derived on the fly), so
   the model is already shaped for Jira sync in Phase 7. The Gantt's weeks are
   7-day slices of a stored sprint's date range.
4. **Labels** are generic Checkout-epic components on the synthetic data.

## Data model additions

- `WorkItem.labels?: string[]` — source for the horizontal lanes (a lane's total
  is the sum of points of items carrying that label). Optional; absent = no
  labels.
- `Sprint` — `{ id, teamId, name, startDate, endDate }`. Stored; the dropdown
  lists these. Jira sprints map onto this shape in Phase 7.
- `PlannedPlacement` — `{ id, workItemKey, sprintId, weekIndex }`. The
  **human-authored** output of planning: which week a work item is slotted into.
  Stored separately from Jira-sourced fields so it survives syncs. One placement
  per work item (unplaced items live in the bag).

## Engine

A new pure module (`packages/engine/src/week.ts`) reusing the existing
`dayCapacity`:

- `sprintWeeks(start, end, workingDays)` → 7-day `WeekWindow` slices.
- `weeklyPlan({ sprint, capacityCtx, placedPointsByWeek, yellowLoadFraction })`
  → per-week `{ index, start, end, capacity, placedPoints, verdict }`.
  - `capacity` = `Σ dayCapacity(d)` over the week's working days. Because
    `dayCapacity` prorates `baseVelocity / sprintWorkingDays`, the weeks
    partition sprint capacity exactly, and PTO/on-call landing in one week drags
    only that week.
  - `verdict` = load vs capacity: **red** if `placed > capacity`, **yellow** if
    `placed ≥ capacity × yellowLoadFraction` (and not red), else **green**. An
    empty week is green; a zero-capacity week with any load is red.

`week_yellow_load_fraction` is added to `EngineConfig` / `readEngineConfig` and
the default settings, alongside the existing knobs.

Engine's internal cadence-window type `Sprint` is renamed to `SprintWindow` to
free the name `Sprint` for the stored domain entity.

## Backend

- Schema: `work_item.labels` (JSON TEXT), a `sprint` table, and a
  `planned_placement` table (unique on `work_item_key`). Insert/delete order and
  indexes updated; additive migration for the new `work_item.labels` column.
- `persist.ts` round-trips the new tables and the labels column.
- `repository.ts` + a new `routes/planning.ts`: `PUT /api/placements` (upsert a
  work item's week) and `DELETE /api/placements/:workItemKey` (back to the bag),
  validated like the rest of the config write API.
- Synthetic importer: assign each item a Checkout-epic label, generate the
  current + next few sprints, and seed a calibrated set of placements so the
  board opens with a green/yellow/red mix (the rest stay in the bag).

## Frontend

- A new **Gantt** tab (4th tab).
- `lib/gantt.ts` scopes labels→lanes and placed-vs-bag, and runs `weeklyPlan` in
  the browser for live recompute (mirrors `lib/projection.ts`).
- Components: sprint selector, week columns with a per-week G/Y/R capacity
  header, the backlog bag, horizontal label lanes, and an engineer strip whose
  avatars open a per-person weekly-capacity modal.
- Native HTML5 drag-and-drop (no new dependency). Placing persists via the API
  when connected; in bundled (no-backend) mode it's in-memory only, exactly like
  the Timeline tab's what-if cuts.
- The `week_yellow_load_fraction` knob is added to the Configuration tab's
  Planning knobs.

## Build order (each a reviewable slice)

1. **Foundation** — types, engine `weeklyPlan`, sprint + placement tables,
   synthetic seeding, unit tests. *(No UI; provable by tests + DB inspection.)*
2. **Read-only board** — week columns, lanes, per-week color, engineer modal.
3. **The bag + drag-to-place** — the live-recompute loop.
4. **Persistence** (API writes) + Playwright e2e.

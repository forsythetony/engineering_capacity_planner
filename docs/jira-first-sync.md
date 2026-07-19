# Your first Jira sync

This guide walks you from an empty install to a capacity plan populated with live
Jira data — using the **Connect to Jira** wizard on the Configuration tab. It
also explains how the sync works under the hood and how to get unstuck when Jira
pushes back.

If you just want to *see* the flow without a real Jira account, jump to
[Try it offline first](#try-it-offline-first).

---

## What you'll end up with

A local capacity plan where **Jira owns the facts** (epics, stories, tickets,
dependencies, sprints) and **you own the intent** (PTO, on-call, per-person
velocity, milestones, and your Gantt placements). Syncing pulls the facts in and
reconciles them against your intent — it never clobbers the planning work you've
done. See [How it works](#how-it-works-under-the-hood) for the details.

---

## Prerequisites

You need three connection values, which live **only in the environment** (never
in the shareable database — the SQLite file you pass around carries no secrets):

| Value | Where it comes from |
| --- | --- |
| `JIRA_BASE_URL` | Your site URL, e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | The email of the account the token belongs to |
| `JIRA_API_TOKEN` | Create one at **id.atlassian.com → Security → API tokens** |

Put them in a `.env` at the repo root (copy `.env.example`) and switch the data
source to Jira:

```bash
ECP_DATA_SOURCE=jira
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@your-org.com
JIRA_API_TOKEN=your-token-here
```

Then start the app:

```bash
npm run dev
```

> The field **mapping** (which field is story points, etc.) is *not* set here —
> you'll point at it in the wizard, and it's remembered per board in the
> database. The `JIRA_*` mapping vars in `.env.example` are only a bootstrap
> fallback; the app's settings always win.

---

## Try it offline first

Want to rehearse the whole flow with no Jira account? Run the built-in demo
board — an in-memory fake pre-seeded with the synthetic dataset:

```bash
ECP_JIRA_FAKE=true npm run dev
```

Everything below works identically against it: search returns a demo board, an
epic, and people (with avatars), and **Sync** actually populates the plan. It's
the same fake the test suite uses, so it's a faithful rehearsal.

---

## The walkthrough

Open the app and go to the **Configuration** tab. Scroll to **Connect to Jira** —
a five-step wizard: **Connect → Board → Epic → Fields → Members**. You can click
any step; the checkmarks show what's done.

### 1. Connect

A read-only connectivity check. It calls Jira as you (`GET /rest/api/3/myself`)
and shows **● Connected — signed in as *You*** on success. If it can't reach
Jira, it shows what's missing and the env vars to set. Nothing to fill in here —
credentials come from the environment by design.

### 2. Board

Start typing in **Search boards…** and pick your Agile board. Selecting it stores
the board id (used to read sprints) **and** its project key, which unlocks the
next steps. The board's project is what "epics" and "sample" are scoped to.

### 3. Epic

Search the epics in that project and choose the one to track. The tool imports
that epic's subtree — its stories, and the tickets under them. (One epic at a
time for now.)

### 4. Fields

This is the part that makes the tool work with **whatever fields your team
already has**. Click **Load sample from Jira** (it auto-loads here) — it fetches
a real ticket and lists every field with its value. Click to assign roles:

- **Story points** — the field your capacity math burns down (required).
- **'Blocks' link type** — the issue-link type that means "blocks", for the
  dependency graph (required).
- **Sprint** and **Labels** — optional; labels feed the Gantt's swimlanes.

You're pointing at real fields instead of memorizing `customfield_10016`. Each
choice saves immediately; the summary line at the bottom reflects the current
mapping.

### 5. Members

Two ways to build your roster:

- **Add from Jira** — search Jira's people picker and add a teammate. Their name
  and avatar come from Jira and they're linked automatically.
- **Add locally, then link** — create a person by hand (name + velocity) in the
  Team members section, then use **link to Jira** here to bind them to their Jira
  account.

Linking matters: on sync, a Jira assignee **folds onto the linked member** —
keeping the velocity and PTO you configured — instead of creating a duplicate.

---

## Syncing

Once the required mapping is in place (project + story points + blocks link
type), the **Sync button in the top navigation unlocks**. It's visible on every
tab and its color tells you how fresh your data is:

| Color | Meaning |
| --- | --- |
| 🟢 Green | Synced less than an hour ago |
| 🟡 Yellow | Synced within the last day |
| 🔴 Red | More than a day ago, or never synced |
| ⚪ Locked (grayed) | Setup isn't complete yet — click it for a pointer to the wizard |

Click it to pull Jira in. You'll see a short summary ("Synced 40 items · 2
sprints · +4 members"). The color resets to green and ages on its own from there.

Re-sync whenever Jira changes. It's safe to run repeatedly — see below for
exactly what's preserved.

---

## How it works under the hood

### Facts vs. intent

The core idea: **Jira owns facts, you own intent**, and sync reconciles the two
(`packages/backend/src/db/reconcile.ts`).

- **Facts — replaced from Jira each sync:** epics, stories, work items,
  dependencies, sprints.
- **Intent — always preserved:** PTO, on-call, velocity overrides, milestones
  ("relevant days"), the tuning knobs, team cadence, each member's base velocity,
  and — the artifact the whole tool exists for — your **Gantt placements**.

On each sync the reconcile step also tidies up: a placement whose ticket is now
`Done` is auto-pulled from its slot (a finished ticket needs no capacity), and a
placement is dropped if its ticket or sprint no longer exists in Jira.

### The adapter seam

Every Jira call goes through one interface, `JiraClient`
(`packages/backend/src/jira/client.ts`). The real implementation talks HTTP
(`http-client.ts`); an in-memory `FakeJiraClient` mirrors the exact wire shapes,
which is how the demo board and the whole test suite run with no network. The
raw Jira issues are translated into the domain model in one pure place, the
`mapper.ts`.

### Which Jira APIs

Current Jira Cloud REST v3 + Agile 1.0:

- `GET /rest/api/3/myself` — the Connect check.
- `GET /rest/api/3/field` and `/issueLinkType` — the field/link catalogs behind
  the mapper.
- `POST /rest/api/3/search/jql` — cursor-paginated issue search. (The older
  `/rest/api/3/search` is gone — it returns `410`.)
- `GET /rest/api/3/issue/{key}` — the mapping sample.
- `GET /rest/agile/1.0/board` and `/board/{id}/sprint` — boards and their
  sprints.
- `GET /rest/api/3/user/search` — the people picker.

Hierarchy (epic → stories → tickets) is read by **parent-chain depth**, not by
issue-type names, so it works across both team-managed and company-managed
projects. Sprint datetimes are trimmed to calendar dates to drive the Gantt's
week columns.

### Where settings live

Your mapping is persisted in the database `settings` table (keys like
`jira_project_key`, `jira_board_id`, `jira_story_points_field`,
`jira_blocks_link_type`, `last_synced_at`). The connection secrets stay in the
environment. The "setup complete" gate the Sync button uses is
`isMappingComplete()` — project key **+** story-points field **+** blocks link
type.

---

## Troubleshooting

### The Sync button stays locked (gray)

Setup isn't complete. It unlocks only when **all three** of project key, story
points field, and blocks link type are mapped, **and** a live backend is
connected. If you're on bundled sample data (the header says "Bundled sample
data"), start the backend. Otherwise finish the **Fields** step — clicking the
locked button opens a pointer to the wizard.

### "Jira connection incomplete — set: JIRA_BASE_URL, …"

One or more connection secrets are missing from the environment. Set
`JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in your `.env` (or the shell
that launches the backend) and restart. The Connect step lists exactly which are
absent.

### "Jira field mapping incomplete — set: …" (a 400 on Sync)

You reached Jira but a required field role isn't mapped. Go to **Fields** and set
the missing one (story points and the blocks link type are required).

### "Jira request failed: … 401 / 403"

Authentication or permissions. Check that:

- the API token is valid and belongs to `JIRA_EMAIL`;
- that account can see the project/board you selected;
- `JIRA_BASE_URL` is the full site URL (`https://your-org.atlassian.net`), no
  trailing path.

### "Jira request failed: … 410"

Something is calling the retired `/rest/api/3/search` endpoint. The app uses
`/search/jql`; a 410 usually means a proxy or gateway is rewriting the request —
check anything sitting between you and Atlassian.

### The Connect step says connected, but Board/Epic search is empty

- **No boards:** the account may not have Agile board access, or the project has
  no board. Sprints (and the Gantt week columns) depend on a board.
- **No epics:** confirm the selected board's project actually contains epics, and
  that your account can see them.

### Story points import as 0

The **Story points** role is pointed at the wrong field. On the **Fields** step,
find the field that actually shows a number on the sample ticket and re-assign
it. Jira instances vary — it's often `customfield_10016`, but not always.

### Dependencies don't show up

The **'Blocks' link type** is unset or wrong. Different sites name the link type
differently; pick the one whose outward description is "blocks" on the Fields
step.

### A person appears twice after syncing

A local member wasn't linked to their Jira account before the sync, so the synced
assignee came in as a separate member. Delete the duplicate, then **link** the
person you want to keep (Members step) so future syncs fold onto them.

### A Gantt placement disappeared after a sync

Expected in two cases: the ticket came back `Done` (auto-pulled to free the
week's capacity), or its ticket/sprint no longer exists in Jira. Anything still
present and unfinished keeps its placement.

---

## Sync cache & shareable fixtures

Every successful Sync also writes the raw Jira payload to
`./data/cache/jira-last-sync.json` (gitignored — do not commit). To share
realistic board topology with collaborators without leaking titles or people:

```bash
npm run export:obfuscated
# → packages/backend/testdata/obfuscated-jira.json
```

Labels, statuses, points, and dependency structure are kept; summaries, people,
emails, avatars, and project keys are anonymized. Tests can hydrate
`FakeJiraClient` from that file via `fakeClientFromFixture`.

---

## Ongoing use

- **Re-sync freely.** It's idempotent with respect to your intent — placements,
  PTO, velocities, and knobs survive every sync.
- **Watch the color.** Yellow/red in the nav is your cue that the plan may be
  stale relative to Jira.
- **Seeding a test instance.** `npm run seed:jira` pushes the synthetic dataset
  into a real (or `--fake`) Jira so you can prove the whole loop end-to-end; see
  `packages/backend/src/scripts/seed-jira.ts`.

---

*Related: the design rationale for the sync round-trip and field mapping lives in
[`sprint-planning-tool-project-plan.md`](./sprint-planning-tool-project-plan.md)
(§7, and the Phase 7 / 7.1 notes).*

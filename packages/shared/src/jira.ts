/**
 * Jira helpers and types shared by the backend and the frontend (project plan
 * §7). Kept in `@ecp/shared` so the ticket-driven field mapper and the sync log
 * agree on shapes without either side importing the other.
 */

/**
 * A Jira issue key: an uppercase project prefix, a dash, then a number
 * (e.g. `CKT-42`). Anchored variants are derived from this at the call site.
 */
const ISSUE_KEY = /[A-Z][A-Z0-9]+-\d+/;

/**
 * Pull a Jira issue key out of whatever the user pasted — a bare key
 * (`CKT-42`, `ckt-42`), or a browse URL
 * (`https://acme.atlassian.net/browse/CKT-42?filter=…`,
 * `https://acme.atlassian.net/jira/software/projects/CKT/boards/1?selectedIssue=CKT-42`).
 * Returns the normalized upper-case key, or `null` when nothing key-shaped is
 * present. The last key-shaped token wins, so a URL that also contains a project
 * segment (`/projects/CKT/`) still resolves to the issue at the end.
 */
export function parseJiraTicketKey(input: string): string | null {
  if (typeof input !== 'string') return null;
  const upper = input.toUpperCase().trim();

  // A bare key (possibly with surrounding whitespace) is the common case.
  const bare = new RegExp(`^${ISSUE_KEY.source}$`).exec(upper);
  if (bare) return bare[0];

  // Otherwise scan for key-shaped tokens and take the last one — in a browse
  // URL the issue key trails any project-key path segment.
  const all = upper.match(new RegExp(ISSUE_KEY.source, 'g'));
  return all && all.length > 0 ? all[all.length - 1]! : null;
}

/**
 * Whether a Jira issue-link *type* expresses the "blocks / is blocked by"
 * relationship. In stock Jira this is the native `Blocks` link type; teams can
 * rename it, so we match on the semantic words in the name and the
 * inward/outward phrases rather than requiring the literal `"Blocks"`.
 */
export function isBlocksLinkType(t: {
  name: string;
  inward?: string;
  outward?: string;
}): boolean {
  const haystack = `${t.name} ${t.inward ?? ''} ${t.outward ?? ''}`.toLowerCase();
  return /\bblock/.test(haystack);
}

/**
 * One recorded change from a sync's reconcile, for the sync log (project plan
 * §7). `entity` is the Jira key / member name the change is about; `detail` is a
 * short human sentence. `category` groups cards for at-a-glance scanning.
 */
export interface SyncChange {
  category:
    | 'item-added'
    | 'item-removed'
    | 'status'
    | 'points'
    | 'assignee'
    | 'placement-added'
    | 'placement-conflict'
    | 'placement-pulled'
    | 'placement-dropped'
    | 'member-added'
    | 'sprint-added'
    | 'sprint-removed';
  entity: string;
  detail: string;
}

/** A persisted sync-log entry: one row per `POST /api/sync`. */
export interface SyncLogEntry {
  id: string;
  /** ISO-8601 datetime the sync completed. */
  syncedAt: string;
  /** Data source the sync pulled from, e.g. `"jira"`. */
  source: string;
  /** Headline counts (mirrors the backend `ReconcileSummary`). */
  summary: Record<string, number>;
  /** The itemized list of what changed, shown in the card's modal. */
  changes: SyncChange[];
}

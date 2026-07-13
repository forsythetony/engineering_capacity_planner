/**
 * Small Jira issue links, reused across the header, backlog rows, cards, logs,
 * and dependency-graph nodes.
 */

/**
 * The "external link" glyph as a set of stroke paths (Lucide `external-link`),
 * shared so the HTML and in-SVG renderings draw the identical icon.
 */
export const JIRA_ICON_PATHS = [
  'M15 3h6v6',
  'M10 14 21 3',
  'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
] as const;

export const DEFAULT_JIRA_BASE_URL = 'https://chewyinc.atlassian.net';

export function jiraIssueHref(jiraKey: string, baseUrl = DEFAULT_JIRA_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(jiraKey)}`;
}

function JiraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {JIRA_ICON_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

interface JiraLinkProps {
  /** The issue key this would open, e.g. `"CKT-2"` (also the epic key). */
  jiraKey: string;
  /** Destination override; defaults to the Chewy Jira browse URL. */
  href?: string | null;
  className?: string;
}

/** HTML rendering — for the epic header and backlog rows. */
export function JiraLink({ jiraKey, href = jiraIssueHref(jiraKey), className }: JiraLinkProps) {
  const label = `Open ${jiraKey} in Jira`;
  const cls = `jira-link${className ? ` ${className}` : ''}`;

  return (
    <a
      className={cls}
      href={href ?? jiraIssueHref(jiraKey)}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      data-testid={`jira-link-${jiraKey}`}
    >
      <JiraIcon />
    </a>
  );
}

export function JiraKeyLink({ jiraKey, href = jiraIssueHref(jiraKey), className }: JiraLinkProps) {
  const label = `Open ${jiraKey} in Jira`;
  return (
    <a
      className={`jira-key-link${className ? ` ${className}` : ''}`}
      href={href ?? jiraIssueHref(jiraKey)}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      data-testid={`jira-key-link-${jiraKey}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="jira-key-text">{jiraKey}</span>
      <span className="jira-key-icon" aria-hidden="true">
        <JiraIcon />
      </span>
    </a>
  );
}

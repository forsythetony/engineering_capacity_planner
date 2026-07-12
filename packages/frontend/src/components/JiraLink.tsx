/**
 * A small "open in Jira" link icon, reused across the header, backlog rows, and
 * dependency-graph nodes. It is intentionally inert for now: Jira wiring lands
 * in Phase 7 (the mapping settings already exist but no base URL is configured
 * yet), so with no `href` the icon renders as a non-navigating affordance. Pass
 * an `href` once a Jira base URL is available and it becomes a real link.
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

interface JiraLinkProps {
  /** The issue key this would open, e.g. `"CKT-2"` (also the epic key). */
  jiraKey: string;
  /** Destination once Jira is wired up; inert placeholder while `null`. */
  href?: string | null;
  className?: string;
}

/** HTML rendering — for the epic header and backlog rows. */
export function JiraLink({ jiraKey, href = null, className }: JiraLinkProps) {
  const label = `Open ${jiraKey} in Jira`;
  const icon = (
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

  const cls = `jira-link${className ? ` ${className}` : ''}`;

  if (href) {
    return (
      <a className={cls} href={href} target="_blank" rel="noreferrer" title={label} aria-label={label}>
        {icon}
      </a>
    );
  }
  // No destination yet: a non-navigating affordance (title says "coming soon").
  return (
    <span
      className={`${cls} inert`}
      role="link"
      aria-disabled="true"
      title={`${label} (not yet linked)`}
      aria-label={label}
      data-testid={`jira-link-${jiraKey}`}
    >
      {icon}
    </span>
  );
}

import { describe, expect, it } from 'vitest';
import { jiraIssueHref } from '../src/components/JiraLink';

describe('jiraIssueHref', () => {
  it('builds Chewy Jira browse links by default', () => {
    expect(jiraIssueHref('VSRB-1345')).toBe('https://chewyinc.atlassian.net/browse/VSRB-1345');
  });

  it('allows an explicit base URL without double slashes', () => {
    expect(jiraIssueHref('CKT-42', 'https://example.atlassian.net/')).toBe(
      'https://example.atlassian.net/browse/CKT-42',
    );
  });
});

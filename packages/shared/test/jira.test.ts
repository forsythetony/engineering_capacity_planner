import { describe, expect, it } from 'vitest';
import { isBlocksLinkType, parseJiraTicketKey } from '../src/jira.js';

describe('parseJiraTicketKey', () => {
  it('accepts a bare key, normalizing case and whitespace', () => {
    expect(parseJiraTicketKey('CKT-42')).toBe('CKT-42');
    expect(parseJiraTicketKey('  ckt-42 ')).toBe('CKT-42');
    expect(parseJiraTicketKey('AB12-7')).toBe('AB12-7');
  });

  it('extracts the issue key from a browse URL', () => {
    expect(parseJiraTicketKey('https://acme.atlassian.net/browse/CKT-42')).toBe('CKT-42');
    expect(parseJiraTicketKey('https://acme.atlassian.net/browse/CKT-42?filter=all')).toBe('CKT-42');
  });

  it('prefers the trailing issue key over a project path segment', () => {
    const url =
      'https://acme.atlassian.net/jira/software/projects/CKT/boards/1?selectedIssue=CKT-99';
    expect(parseJiraTicketKey(url)).toBe('CKT-99');
  });

  it('returns null when there is no key-shaped token', () => {
    expect(parseJiraTicketKey('')).toBeNull();
    expect(parseJiraTicketKey('not a ticket')).toBeNull();
    expect(parseJiraTicketKey('CKT')).toBeNull();
    expect(parseJiraTicketKey('123')).toBeNull();
  });
});

describe('isBlocksLinkType', () => {
  it('matches the native Blocks link type', () => {
    expect(isBlocksLinkType({ name: 'Blocks', inward: 'is blocked by', outward: 'blocks' })).toBe(true);
  });

  it('matches a renamed type via its inward/outward phrasing', () => {
    expect(isBlocksLinkType({ name: 'Dependency', inward: 'is blocked by', outward: 'blocks' })).toBe(true);
  });

  it('rejects unrelated link types', () => {
    expect(isBlocksLinkType({ name: 'Relates', inward: 'relates to', outward: 'relates to' })).toBe(false);
    expect(isBlocksLinkType({ name: 'Cloners', inward: 'is cloned by', outward: 'clones' })).toBe(false);
  });
});

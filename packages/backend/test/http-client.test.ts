import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpJiraClient } from '../src/jira/http-client.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('HttpJiraClient', () => {
  it('paginates board sprints so late-numbered active sprints are imported', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const startAt = Number(url.searchParams.get('startAt') ?? 0);
      const page =
        startAt === 0
          ? {
              values: [{ id: 1, name: 'Sprint 1', state: 'closed' }],
              isLast: false,
              maxResults: 1,
              total: 2,
            }
          : {
              values: [{ id: 54, name: 'VSRB Sprint 54', state: 'active' }],
              isLast: true,
              maxResults: 1,
              total: 2,
            };
      return Response.json(page);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpJiraClient({
      baseUrl: 'https://chewyinc.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token',
    });

    const sprints = await client.listSprints(4623);

    expect(sprints.map((s) => s.id)).toEqual([1, 54]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(firstUrl.pathname).toBe('/rest/agile/1.0/board/4623/sprint');
    expect(firstUrl.searchParams.get('state')).toBe('active,future,closed');
    expect(firstUrl.searchParams.get('startAt')).toBe('0');
    const secondUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(secondUrl.searchParams.get('startAt')).toBe('1');
  });
});

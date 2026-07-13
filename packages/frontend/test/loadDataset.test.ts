import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBundledDataset, loadDataset } from '../src/data/loadDataset';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadBundledDataset', () => {
  it('returns the bundled synthetic epic', () => {
    const data = loadBundledDataset();
    expect(data.epics[0]?.key).toBe('CKT');
    expect(data.workItems).toHaveLength(50);
  });
});

describe('loadDataset', () => {
  it('uses the API when it returns a valid dataset', async () => {
    const apiDataset = { ...loadBundledDataset(), epics: [{ key: 'API', title: 'From API', teamId: 'team-platform' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(apiDataset), { status: 200 })),
    );
    const { dataset, source } = await loadDataset();
    expect(source).toBe('api');
    expect(dataset.epics[0]?.key).toBe('API');
  });

  it('uses the API when it returns a valid empty dataset', async () => {
    const emptyDataset = {
      teams: [],
      members: [],
      velocityOverrides: [],
      pto: [],
      oncall: [],
      epics: [],
      milestones: [],
      stories: [],
      sprints: [],
      workItems: [],
      dependencies: [],
      placements: [],
      settings: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(emptyDataset), { status: 200 })),
    );
    const { dataset, source } = await loadDataset();
    expect(source).toBe('api');
    expect(dataset.epics).toHaveLength(0);
  });

  it('falls back to the bundled dataset when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    const { dataset, source } = await loadDataset();
    expect(source).toBe('bundled');
    expect(dataset.epics[0]?.key).toBe('CKT');
  });

  it('falls back when the API returns a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { source } = await loadDataset();
    expect(source).toBe('bundled');
  });

  it('falls back when the API returns an invalid body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ epics: [] }), { status: 200 })),
    );
    const { source } = await loadDataset();
    expect(source).toBe('bundled');
  });
});

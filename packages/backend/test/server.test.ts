import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('API server', () => {
  it('auto-seeds an empty database and serves the dataset', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/dataset' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.epics[0].key).toBe('CKT');
    expect(data.workItems).toHaveLength(50);
  });

  it('reports a summary consistent with the dataset', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.statusCode).toBe(200);
    const summary = res.json();
    expect(summary.epics).toEqual(['CKT']);
    expect(summary.workItems).toBe(50);
    expect(summary.dependencies).toBeGreaterThan(0);
  });

  it('sends a permissive CORS header for cross-origin dev fetches', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('leaves the database empty when seeding is disabled', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.json().epics).toEqual([]);
  });

  it('answers the health check', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().status).toBe('ok');
  });

  it('advertises the mutating verbs in CORS', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });
});

describe('Configuration write API', () => {
  it('patches a settings knob and reflects it in the dataset', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { oncall_multiplier: 0.3 },
    });
    expect(res.statusCode).toBe(200);
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const knob = dataset.settings.find((s: any) => s.key === 'oncall_multiplier');
    expect(JSON.parse(knob.value)).toBe(0.3);
  });

  it('creates then deletes a member through the API', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/members',
      payload: { teamId: 'team-platform', name: 'Zoe', baseVelocity: 9 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const del = await app.inject({ method: 'DELETE', url: `/api/members/${id}` });
    expect(del.statusCode).toBe(204);
  });

  it('updates team cadence', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/teams/team-platform',
      payload: { sprintLengthDays: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sprintLengthDays).toBe(7);
  });

  it('maps validation failures to 400 and missing resources to 404', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const bad = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { bogus: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBeDefined();

    const missing = await app.inject({ method: 'DELETE', url: '/api/pto/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('enforces the gating invariant with a 409', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    const gate = dataset.milestones.find((m: any) => m.isGating);
    const res = await app.inject({ method: 'DELETE', url: `/api/milestones/${gate.id}` });
    expect(res.statusCode).toBe(409);
  });
});

describe('Database snapshot + import API', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('snapshots the live DB file to a timestamped copy', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ecp-srv-'));
    app = await buildServer({ dbPath: join(dir, 'ecp.db') });

    const res = await app.inject({ method: 'POST', url: '/api/db/snapshot' });
    expect(res.statusCode).toBe(200);
    expect(res.json().file).toMatch(/ecp-snapshot-.*\.db$/);
    expect(readdirSync(dir).some((f) => f.includes('snapshot'))).toBe(true);
  });

  it('rejects snapshotting an in-memory database with a 400', async () => {
    app = await buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'POST', url: '/api/db/snapshot' });
    expect(res.statusCode).toBe(400);
  });

  it('imports an uploaded database and replaces the dataset', async () => {
    // Produce a real ECP database on disk via a throwaway server, then upload it.
    dir = mkdtempSync(join(tmpdir(), 'ecp-srv-'));
    const srcPath = join(dir, 'source.db');
    const src = await buildServer({ dbPath: srcPath, syntheticSeed: 42 });
    await src.inject({ method: 'GET', url: '/api/dataset' }); // force seed
    await src.close();
    const bytes = readFileSync(srcPath);

    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/db/import',
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.workItems).toBe(50);

    const dataset = (await app.inject({ method: 'GET', url: '/api/dataset' })).json();
    expect(dataset.workItems).toHaveLength(50);
  });

  it('rejects a non-SQLite upload with a 400', async () => {
    app = await buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/db/import',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('definitely not sqlite'),
    });
    expect(res.statusCode).toBe(400);
  });
});

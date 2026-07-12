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
    app = buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/dataset' });
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.epics[0].key).toBe('CKT');
    expect(data.workItems).toHaveLength(50);
  });

  it('reports a summary consistent with the dataset', async () => {
    app = buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.statusCode).toBe(200);
    const summary = res.json();
    expect(summary.epics).toEqual(['CKT']);
    expect(summary.workItems).toBe(50);
    expect(summary.dependencies).toBeGreaterThan(0);
  });

  it('sends a permissive CORS header for cross-origin dev fetches', async () => {
    app = buildServer({ dbPath: ':memory:' });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('leaves the database empty when seeding is disabled', async () => {
    app = buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/api/summary' });
    expect(res.json().epics).toEqual([]);
  });

  it('answers the health check', async () => {
    app = buildServer({ dbPath: ':memory:', seedIfEmpty: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

/**
 * Configuration write API (project plan §6 "Configuration tab"). These are the
 * only mutating endpoints; the rest of the API is read-only. Each handler
 * delegates to a validated {@link import('../db/repository.js') repository}
 * function, which throws {@link import('../http-error.js').HttpError} on bad
 * input — translated to a status code by the server's error handler.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as repo from '../db/repository.js';

type IdParams = { id: string };

export function registerConfigRoutes(app: FastifyInstance, db: Db): void {
  // --- Settings knobs ------------------------------------------------------
  app.patch('/api/settings', async (req) => ({
    settings: repo.upsertGlobalSettings(db, (req.body ?? {}) as Record<string, unknown>),
  }));
  app.patch<{ Params: { key: string } }>('/api/epics/:key/settings', async (req) => ({
    settings: repo.upsertEpicSettings(db, req.params.key, (req.body ?? {}) as Record<string, unknown>),
  }));

  // --- Team cadence --------------------------------------------------------
  app.put<{ Params: IdParams }>('/api/teams/:id', async (req) =>
    repo.updateTeam(db, req.params.id, (req.body ?? {}) as repo.TeamPatch),
  );

  // --- Members -------------------------------------------------------------
  app.post('/api/members', async (req, reply) => {
    const member = repo.createMember(db, (req.body ?? {}) as never);
    reply.code(201);
    return member;
  });
  app.put<{ Params: IdParams }>('/api/members/:id', async (req) =>
    repo.updateMember(db, req.params.id, (req.body ?? {}) as never),
  );
  app.delete<{ Params: IdParams }>('/api/members/:id', async (req, reply) => {
    repo.deleteMember(db, req.params.id);
    reply.code(204);
  });

  // --- PTO -----------------------------------------------------------------
  app.post('/api/pto', async (req, reply) => {
    const pto = repo.createPto(db, (req.body ?? {}) as never);
    reply.code(201);
    return pto;
  });
  app.delete<{ Params: IdParams }>('/api/pto/:id', async (req, reply) => {
    repo.deletePto(db, req.params.id);
    reply.code(204);
  });

  // --- On-call -------------------------------------------------------------
  app.post('/api/oncall', async (req, reply) => {
    const oncall = repo.createOncall(db, (req.body ?? {}) as never);
    reply.code(201);
    return oncall;
  });
  app.delete<{ Params: IdParams }>('/api/oncall/:id', async (req, reply) => {
    repo.deleteOncall(db, req.params.id);
    reply.code(204);
  });

  // --- Velocity overrides --------------------------------------------------
  app.post('/api/velocity-overrides', async (req, reply) => {
    const vo = repo.createVelocityOverride(db, (req.body ?? {}) as never);
    reply.code(201);
    return vo;
  });
  app.delete<{ Params: IdParams }>('/api/velocity-overrides/:id', async (req, reply) => {
    repo.deleteVelocityOverride(db, req.params.id);
    reply.code(204);
  });

  // --- Epic milestones ("relevant days") -----------------------------------
  app.post<{ Params: { key: string } }>('/api/epics/:key/milestones', async (req, reply) => {
    const ms = repo.createMilestone(db, req.params.key, (req.body ?? {}) as never);
    reply.code(201);
    return ms;
  });
  app.put<{ Params: IdParams }>('/api/milestones/:id', async (req) =>
    repo.updateMilestone(db, req.params.id, (req.body ?? {}) as never),
  );
  app.delete<{ Params: IdParams }>('/api/milestones/:id', async (req, reply) => {
    repo.deleteMilestone(db, req.params.id);
    reply.code(204);
  });
}

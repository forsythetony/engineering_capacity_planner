/**
 * Gantt Planner write API (project plan §6a). The planned placements are the
 * human-authored artifact the tool exists to produce, so they persist here
 * (kept separate from source/Jira fields). Handlers delegate to validated
 * {@link import('../db/repository.js') repository} functions that throw
 * {@link import('../http-error.js').HttpError} on bad input.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as repo from '../db/repository.js';

export function registerPlanningRoutes(app: FastifyInstance, db: Db): void {
  // Place a work item into a sprint week (or move it there). Upsert by work item.
  app.put('/api/placements', async (req) =>
    repo.upsertPlacement(db, (req.body ?? {}) as never),
  );

  // Send a work item back to the backlog bag.
  app.delete<{ Params: { workItemKey: string } }>(
    '/api/placements/:workItemKey',
    async (req, reply) => {
      repo.deletePlacement(db, req.params.workItemKey);
      reply.code(204);
    },
  );
}

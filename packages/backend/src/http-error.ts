/**
 * A small typed error carrying an HTTP status code, thrown by the repository /
 * route layer and translated to a response by the Fastify error handler
 * (see {@link import('./server.js')}). Keeps validation/not-found handling
 * declarative without pulling in a framework.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 400 — the request body/params failed validation. */
export const badRequest = (message: string): HttpError => new HttpError(400, message);
/** 404 — the addressed resource does not exist. */
export const notFound = (message: string): HttpError => new HttpError(404, message);
/** 409 — the request conflicts with an invariant (e.g. the last gating day). */
export const conflict = (message: string): HttpError => new HttpError(409, message);

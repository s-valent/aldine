import type { FastifyInstance } from 'fastify';

/**
 * Optional error tracking. Structured error logging is always on; Sentry is
 * enabled only when SENTRY_DSN is set (and @sentry/node is installed). Dynamic
 * import keeps it out of the hot path and tolerant of a missing package.
 */
let sentry: { captureException(e: unknown): void } | null = null;

export async function initObservability(app: FastifyInstance): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    try {
      const Sentry = await import('@sentry/node');
      Sentry.init({ dsn, tracesSampleRate: 0, environment: process.env.NODE_ENV || 'production' });
      sentry = Sentry;
      console.log('[aldine] Sentry error tracking enabled');
    } catch {
      console.warn('[aldine] SENTRY_DSN is set but @sentry/node is not installed — run `npm i @sentry/node` to enable it');
    }
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode;
    req.log.error({ err, url: req.url, method: req.method }, 'request error');
    if (!status || status >= 500) captureError(err);
    if (!reply.sent) {
      reply.code(status && status < 500 ? status : 500)
        .send({ error: status && status < 500 ? err.message : 'Internal server error' });
    }
  });
}

export function captureError(e: unknown): void {
  if (sentry) { try { sentry.captureException(e); } catch { /* never let telemetry throw */ } }
}

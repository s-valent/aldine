import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { hocuspocus, flushAllDocs } from './collab.js';
import { commitAll } from './gitops.js';
import { initObservability, captureError } from './observability.js';
import { initDb, closeDb } from './db/index.js';
import { initRateLimit } from './ratelimit.js';

// Never let a stray rejection take down the collaboration server.
process.on('unhandledRejection', (reason) => { console.error('[papyr] unhandledRejection', reason); captureError(reason); });

// Select and connect the datastore (JSON default, or Postgres via DATABASE_URL) before anything uses it.
await initDb();
// Connect Redis for cross-node rate limiting if REDIS_URL is set (else in-memory).
await initRateLimit();

// trustProxy makes req.ip honor X-Forwarded-For — enable ONLY behind a trusted
// reverse proxy (Caddy/nginx). Off by default so clients can't spoof their IP
// to evade rate limits or lock others out.
const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 32 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === '1' });

await initObservability(app);
await registerRoutes(app);

// Serve the built frontend (production). In dev, Vite serves it and proxies to us.
if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/plugins') || req.url.startsWith('/collab')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.type('text/html').send(fs.readFileSync(path.join(config.webDist, 'index.html')));
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });

// Yjs collaboration over WebSocket at /collab
const wss = new WebSocketServer({ noServer: true });
app.server.on('upgrade', (request, socket, head) => {
  if (request.url && request.url.startsWith('/collab')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      hocuspocus.handleConnection(ws, request);
    });
  } else {
    socket.destroy();
  }
});

console.log(`[papyr] server on :${config.port} — data=${config.dataDir} compiler=${config.compilerUrl}`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[papyr] ${signal} — flushing ${hocuspocus.documents.size} open documents…`);
  try {
    // commit only the branches that actually had open docs (typically a handful),
    // not every project — avoids a SIGTERM fan-out of hundreds of git processes
    const dirty = flushAllDocs();
    await Promise.allSettled(dirty.map((d) => commitAll(d.projectId, d.branch, 'papyr: autosave on shutdown')));
    console.log(`[papyr] flushed ${dirty.length} project/branch(es); exiting`);
  } catch (err) {
    console.error('[papyr] shutdown flush error', err);
  }
  try { await app.close(); await closeDb(); } catch { /* noop */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

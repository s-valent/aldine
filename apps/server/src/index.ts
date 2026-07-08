import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { hocuspocus, flushAllDocs } from './collab.js';
import { commitAll } from './gitops.js';
import { listProjects } from './store.js';
import { initObservability, captureError } from './observability.js';

// Never let a stray rejection take down the collaboration server.
process.on('unhandledRejection', (reason) => { console.error('[papyr] unhandledRejection', reason); captureError(reason); });

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 32 * 1024 * 1024 });

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
    const n = flushAllDocs();
    // best-effort commit of every project's main branch so nothing is lost
    await Promise.allSettled(listProjects().map((p) => commitAll(p.id, 'main', 'papyr: autosave on shutdown')));
    console.log(`[papyr] flushed ${n} documents; exiting`);
  } catch (err) {
    console.error('[papyr] shutdown flush error', err);
  }
  try { await app.close(); } catch { /* noop */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

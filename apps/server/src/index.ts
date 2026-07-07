import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { hocuspocus } from './collab.js';

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 32 * 1024 * 1024 });

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

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import WebSocket from 'ws';

const ROOT = path.resolve('.');
const DATA = path.join(ROOT, '.data-c2');
const SECRETS = path.join(ROOT, '.secrets-c2');
fs.rmSync(DATA, { recursive: true, force: true });
fs.rmSync(SECRETS, { recursive: true, force: true });

const srv = spawn('npx', ['tsx', 'apps/server/src/index.ts'], {
  env: { ...process.env, DATA_DIR: DATA, META_DIR: SECRETS, PORT: '3203' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (await fn()) return true; } catch {} await wait(300); }
  throw new Error('server did not start');
}

let code = 1;
try {
  await until(async () => (await fetch('http://localhost:3203/api/health')).ok);
  const proj = await (await fetch('http://localhost:3203/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'C2' }),
  })).json();

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: 'ws://localhost:3203/collab',
    name: `${proj.id}::main::main.tex`,
    document: doc,
    WebSocketPolyfill: WebSocket,
  });
  await new Promise((r) => provider.on('synced', r));
  // server now loaded the doc from disk; make an edit and let it reach the server
  // (past the 1.5s store debounce is NOT required — SIGTERM flushes in-memory state)
  doc.getText('content').insert(0, 'UNSAVED-BEFORE-SIGTERM ');
  await wait(700); // ensure the update is transmitted to the server's Y.Doc

  const target = path.join(DATA, 'projects', proj.id, 'main.tex');
  srv.kill('SIGTERM');
  // poll disk for the flushed content rather than waiting on the npx wrapper's exit
  await until(() => fs.readFileSync(target, 'utf8').includes('UNSAVED-BEFORE-SIGTERM'), 10000).catch(() => {});
  try { provider.destroy(); } catch {}
  try { srv.kill('SIGKILL'); } catch {}

  const onDisk = fs.readFileSync(target, 'utf8');
  const ok = onDisk.includes('UNSAVED-BEFORE-SIGTERM');
  console.log(ok ? 'C2 PASS: unsaved edit flushed on SIGTERM' : 'C2 FAIL: edit lost');
  console.log('first line:', onDisk.split('\n')[0]);
  code = ok ? 0 : 1;
} catch (err) {
  console.log('C2 FAIL:', err.message);
  try { srv.kill('SIGKILL'); } catch {}
} finally {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(SECRETS, { recursive: true, force: true });
  process.exit(code);
}

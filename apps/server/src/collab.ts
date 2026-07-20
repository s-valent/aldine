import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { branchDir, readMeta } from './store.js';
import { commitAll, ensureWorktree } from './gitops.js';
import { safeJoin, debouncePerKey } from './util.js';
import { AUTH_ENABLED, userFromRequest } from './auth.js';
import { canAccess } from './authz.js';

/**
 * Document naming: `${projectId}/${branch}/${filePath}`
 * Branch names are restricted to not contain `/`… except they can (feature/x).
 * To keep parsing unambiguous we use a `::` separator instead.
 * Doc name = `${projectId}::${branch}::${filePath}`
 */
export function docName(projectId: string, branch: string, filePath: string): string {
  return `${projectId}::${branch}::${filePath}`;
}

export function parseDocName(name: string): { projectId: string; branch: string; filePath: string } | null {
  // Split on only the first two separators: projectId and branch never contain
  // '::' (id/branch charsets exclude ':'), but a file path legitimately can, so
  // the remainder is the whole filePath rather than being rejected as 4+ parts.
  const i = name.indexOf('::');
  if (i < 0) return null;
  const j = name.indexOf('::', i + 2);
  if (j < 0) return null;
  const projectId = name.slice(0, i);
  const branch = name.slice(i + 2, j);
  const filePath = name.slice(j + 2);
  if (!projectId || !branch || !filePath) return null;
  return { projectId, branch, filePath };
}

const TEXT_KEY = 'content';

/** Debounced auto-commit per project::branch after edits settle. */
const scheduleAutoCommit = debouncePerKey(20_000, (key: string) => {
  const [projectId, branch] = key.split('::');
  commitAll(projectId, branch, 'aldine: autosave').catch((err) => console.error('[collab] autocommit failed', err.message));
});

/** Schedule the same debounced auto-commit for non-collab writes (REST file
 *  upload / rename / reference add) so working-tree changes reach git history
 *  even when no Yjs doc is open — not just on the next manual push. */
export function scheduleCommit(projectId: string, branch: string): void {
  scheduleAutoCommit(`${projectId}::${branch}`);
}

/** Docs evicted because their file/branch was deleted — never write these back. */
const tombstoned = new Set<string>();

/** sha1 of the on-disk content per loaded doc — lets us skip redundant disk
 *  writes when a debounced store is unchanged, without a per-store read-back.
 *  Kept in sync with disk at load / refresh / evict / unload; a stale entry
 *  would silently drop a real edit, so every disk-changing path updates it. */
const lastWritten = new Map<string, string>();
const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

export function tombstone(name: string): void { tombstoned.add(name); }
export function untombstone(name: string): void { tombstoned.delete(name); }

/** Ephemeral coordination docs (e.g. the comment-change signal) are never written to disk. */
function isSignalDoc(filePath: string): boolean {
  return filePath.startsWith('.aldine/');
}

export function writeDocToDisk(name: string, document: Y.Doc): void {
  if (tombstoned.has(name)) return;
  const parsed = parseDocName(name);
  if (!parsed) return;
  const { projectId, branch, filePath } = parsed;
  if (isSignalDoc(filePath)) return;
  const dir = branchDir(projectId, branch);
  if (!fs.existsSync(dir)) return; // branch was deleted while doc loaded
  const abs = safeJoin(dir, filePath);
  const text = document.getText(TEXT_KEY).toString();
  // Skip the write when the content is identical to what's on disk (keeps
  // latexmk incremental builds effective) — compared in memory, no disk read.
  const hash = sha1(text);
  if (lastWritten.get(name) === hash) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  lastWritten.set(name, hash);
  scheduleAutoCommit(`${projectId}::${branch}`);
}

// Defining onAuthenticate makes Hocuspocus require a token from every client,
// so only include it when auth is actually enabled (default is open).
const authHook = AUTH_ENABLED ? {
  async onAuthenticate({ documentName, requestHeaders }: { documentName: string; requestHeaders: Record<string, string | string[] | undefined> }) {
    const parsed = parseDocName(documentName);
    if (!parsed) throw new Error('invalid document');
    const user = await userFromRequest(requestHeaders.cookie as string | undefined);
    if (!user) throw new Error('Not authenticated');
    let meta;
    try { meta = await readMeta(parsed.projectId); } catch { throw new Error('project not found'); }
    if (!canAccess(meta, user)) throw new Error('Access denied');
  },
} : {};

// Multi-node collaboration: when REDIS_URL is set, sync Yjs document updates and
// awareness across every app instance via Redis pub/sub, so collaborators land
// on different nodes and still edit the same live document (scaling wall #2).
// Multi-node collaboration (scaling wall #2): with REDIS_URL, the Redis extension
// syncs awareness across nodes and hands a document off cleanly on failover.
// IMPORTANT: run the load balancer with sticky routing so each document lives on
// one node at a time (route by the project id in the /collab doc name). Without
// stickiness two nodes would each seed the same doc from disk and duplicate it.
// See docs/SCALING.md.
const collabExtensions: unknown[] = [];
if (process.env.REDIS_URL) {
  try {
    const { Redis } = await import('@hocuspocus/extension-redis');
    const u = new URL(process.env.REDIS_URL);
    // Forward the full connection through ioredis `options` so managed Redis
    // works: honor the ACL username and rediss:// TLS (a bare host/port/password
    // parse silently dropped both, breaking auth against e.g. Elasticache/Upstash).
    collabExtensions.push(new Redis({
      host: u.hostname,
      port: Number(u.port || 6379),
      options: {
        username: u.username || undefined,
        password: u.password || undefined,
        db: Number((u.pathname || '/0').slice(1)) || 0,
        maxRetriesPerRequest: 3,
        ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
      },
    } as never));
    console.log('[aldine] collab: redis sync across nodes (requires sticky routing)');
  } catch {
    console.warn('[aldine] REDIS_URL set but @hocuspocus/extension-redis is not installed — collab is single-node');
  }
}

export const hocuspocus: Hocuspocus = HocuspocusServer.configure({
  // We handle upgrades ourselves from the Fastify HTTP server.
  quiet: true,
  debounce: 1500,
  maxDebounce: 8000,
  extensions: collabExtensions as never,
  ...authHook,
  async onLoadDocument({ documentName, document }) {
    const parsed = parseDocName(documentName);
    if (!parsed) throw new Error(`invalid document name: ${documentName}`);
    const { projectId, branch, filePath } = parsed;
    if (isSignalDoc(filePath)) return document; // ephemeral coordination channel, nothing to load
    await ensureWorktree(projectId, branch);
    const text = document.getText(TEXT_KEY);
    if (text.length > 0) return document; // already has state (e.g. synced from a peer node)
    let content = '';
    try { content = fs.readFileSync(safeJoin(branchDir(projectId, branch), filePath), 'utf8'); } catch { /* new file → empty */ }
    if (content.length > 0) text.insert(0, content);
    // Seed lastWritten from what's actually on disk right now, so (a) the first
    // store of an unchanged doc skips (no mtime churn) and (b) a doc reopened
    // after an out-of-band disk change tracks the NEW disk state, not a stale
    // hash from a previous load — otherwise a later store could wrongly skip.
    lastWritten.set(documentName, sha1(content));
    return document;
  },
  async onStoreDocument({ documentName, document }) {
    writeDocToDisk(documentName, document);
  },
  // Reclaim the change-tracking entry when Hocuspocus unloads an idle doc, so
  // the map is bounded by live docs and a reopened doc never trusts a stale hash.
  async afterUnloadDocument({ documentName }: { documentName: string }) {
    lastWritten.delete(documentName);
  },
});

/** Flush ALL loaded docs to disk (graceful shutdown); returns the distinct
 *  project/branch pairs that had open docs, so the caller commits only those. */
export function flushAllDocs(): { projectId: string; branch: string }[] {
  const dirty = new Map<string, { projectId: string; branch: string }>();
  hocuspocus.documents.forEach((doc: Y.Doc, name: string) => {
    writeDocToDisk(name, doc);
    const p = parseDocName(name);
    if (p) dirty.set(`${p.projectId}::${p.branch}`, { projectId: p.projectId, branch: p.branch });
  });
  return [...dirty.values()];
}

/**
 * Evict a doc so its pending final store won't resurrect a deleted/renamed file.
 * Removes it from Hocuspocus's registry after tombstoning.
 */
export function evictDoc(projectId: string, branch: string, filePath: string): void {
  const name = docName(projectId, branch, filePath);
  tombstone(name);
  lastWritten.delete(name);
  const doc = hocuspocus.documents.get(name) as (Y.Doc & { destroy?: () => void }) | undefined;
  if (doc) {
    hocuspocus.documents.delete(name);
    try { doc.destroy?.(); } catch { /* noop */ }
  }
  // allow a later re-create of the same path to persist again
  setTimeout(() => untombstone(name), 5000);
}

/** Synchronously flush every loaded doc of a project+branch to disk (before compile/commit/merge). */
export function flushBranchDocs(projectId: string, branch: string): number {
  let n = 0;
  hocuspocus.documents.forEach((doc: Y.Doc & { name: string }, name: string) => {
    const parsed = parseDocName(name);
    if (parsed && parsed.projectId === projectId && parsed.branch === branch) {
      writeDocToDisk(name, doc);
      n++;
    }
  });
  return n;
}

/**
 * After git changed files on disk (merge/revert), push new content into loaded docs
 * so connected editors update in place.
 */
export function refreshBranchDocsFromDisk(projectId: string, branch: string): void {
  hocuspocus.documents.forEach((doc: Y.Doc & { name: string }, name: string) => {
    const parsed = parseDocName(name);
    if (!parsed || parsed.projectId !== projectId || parsed.branch !== branch) return;
    const abs = safeJoin(branchDir(projectId, branch), parsed.filePath);
    let content: string | null = null;
    try { content = fs.readFileSync(abs, 'utf8'); } catch { content = null; }
    if (content === null) {
      // File deleted on disk (merge/reset). Drop the hash so the next store
      // re-materializes the still-open doc's content instead of wrongly skipping
      // (which would leave the editor showing content that never persists).
      lastWritten.delete(name);
      return;
    }
    const text = doc.getText(TEXT_KEY);
    lastWritten.set(name, sha1(content)); // disk now holds `content`; keep tracking in sync
    if (text.toString() === content) return;
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, content!);
    });
  });
}

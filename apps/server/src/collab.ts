import fs from 'node:fs';
import path from 'node:path';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { branchDir } from './store.js';
import { commitAll, ensureWorktree } from './gitops.js';
import { safeJoin, debouncePerKey } from './util.js';

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
  const parts = name.split('::');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { projectId: parts[0], branch: parts[1], filePath: parts[2] };
}

const TEXT_KEY = 'content';

/** Debounced auto-commit per project::branch after edits settle. */
const scheduleAutoCommit = debouncePerKey(20_000, (key: string) => {
  const [projectId, branch] = key.split('::');
  commitAll(projectId, branch, 'papyr: autosave').catch((err) => console.error('[collab] autocommit failed', err.message));
});

/** Docs evicted because their file/branch was deleted — never write these back. */
const tombstoned = new Set<string>();

export function tombstone(name: string): void { tombstoned.add(name); }
export function untombstone(name: string): void { tombstoned.delete(name); }

export function writeDocToDisk(name: string, document: Y.Doc): void {
  if (tombstoned.has(name)) return;
  const parsed = parseDocName(name);
  if (!parsed) return;
  const { projectId, branch, filePath } = parsed;
  const dir = branchDir(projectId, branch);
  if (!fs.existsSync(dir)) return; // branch was deleted while doc loaded
  const abs = safeJoin(dir, filePath);
  const text = document.getText(TEXT_KEY).toString();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // Avoid needless mtime churn (keeps latexmk incremental builds effective)
  try { if (fs.readFileSync(abs, 'utf8') === text) return; } catch { /* new file */ }
  fs.writeFileSync(abs, text);
  scheduleAutoCommit(`${projectId}::${branch}`);
}

export const hocuspocus: Hocuspocus = HocuspocusServer.configure({
  // We handle upgrades ourselves from the Fastify HTTP server.
  quiet: true,
  debounce: 1500,
  maxDebounce: 8000,
  async onLoadDocument({ documentName, document }) {
    const parsed = parseDocName(documentName);
    if (!parsed) throw new Error(`invalid document name: ${documentName}`);
    const { projectId, branch, filePath } = parsed;
    await ensureWorktree(projectId, branch);
    const abs = safeJoin(branchDir(projectId, branch), filePath);
    let content = '';
    try { content = fs.readFileSync(abs, 'utf8'); } catch { /* new file → empty */ }
    const text = document.getText(TEXT_KEY);
    if (text.length === 0 && content.length > 0) {
      text.insert(0, content);
    }
    return document;
  },
  async onStoreDocument({ documentName, document }) {
    writeDocToDisk(documentName, document);
  },
});

/** Flush ALL loaded docs to disk (graceful shutdown). */
export function flushAllDocs(): number {
  let n = 0;
  hocuspocus.documents.forEach((doc: Y.Doc, name: string) => { writeDocToDisk(name, doc); n++; });
  return n;
}

/**
 * Evict a doc so its pending final store won't resurrect a deleted/renamed file.
 * Removes it from Hocuspocus's registry after tombstoning.
 */
export function evictDoc(projectId: string, branch: string, filePath: string): void {
  const name = docName(projectId, branch, filePath);
  tombstone(name);
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
    if (content === null) return; // file gone; leave doc as-is
    const text = doc.getText(TEXT_KEY);
    if (text.toString() === content) return;
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, content!);
    });
  });
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { PROJECT_ID_RE } from './util.js';

/**
 * Review comments — anchored to a text range in a file, threaded, resolvable,
 * optionally carrying a suggested replacement the author can accept.
 * Stored per project outside the git tree (metaRoot/comments/<id>.json).
 */

export interface Reply { author: string; body: string; createdAt: string }
export interface Comment {
  id: string;
  branch: string;
  file: string;
  anchor: { from: number; to: number; quote: string };
  author: string;
  body: string;
  suggestion?: string;   // proposed replacement for the anchored range
  resolved: boolean;
  createdAt: string;
  replies: Reply[];
}

const dir = path.join(config.metaRoot, 'comments');
fs.mkdirSync(dir, { recursive: true });

function file(projectId: string): string {
  if (!PROJECT_ID_RE.test(projectId)) throw new Error('bad project id');
  return path.join(dir, `${projectId}.json`);
}

function load(projectId: string): Comment[] {
  try { return JSON.parse(fs.readFileSync(file(projectId), 'utf8')); } catch { return []; }
}
function save(projectId: string, list: Comment[]): void {
  fs.writeFileSync(file(projectId), JSON.stringify(list, null, 2));
}

export function listComments(projectId: string, branch: string): Comment[] {
  return load(projectId).filter((c) => c.branch === branch).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const MAX_COMMENTS = 2000;
const cap = (s: string | undefined, n: number) => (s == null ? s : s.slice(0, n));

export function addComment(projectId: string, c: Omit<Comment, 'id' | 'createdAt' | 'resolved' | 'replies'>): Comment {
  const list = load(projectId);
  if (list.length >= MAX_COMMENTS) throw new Error('comment limit reached for this project');
  const comment: Comment = {
    ...c,
    body: cap(c.body, 8000)!,
    suggestion: cap(c.suggestion, 8000),
    anchor: { ...c.anchor, quote: cap(c.anchor.quote, 2000)! },
    id: crypto.randomBytes(8).toString('base64url'),
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: [],
  };
  list.push(comment);
  save(projectId, list);
  return comment;
}

export function replyComment(projectId: string, id: string, author: string, body: string): Comment | null {
  const list = load(projectId);
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  if (c.replies.length >= 500) throw new Error('reply limit reached');
  c.replies.push({ author, body: cap(body, 8000)!, createdAt: new Date().toISOString() });
  save(projectId, list);
  return c;
}

export function resolveComment(projectId: string, id: string, resolved: boolean): Comment | null {
  const list = load(projectId);
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  c.resolved = resolved;
  save(projectId, list);
  return c;
}

export function deleteComment(projectId: string, id: string): void {
  save(projectId, load(projectId).filter((c) => c.id !== id));
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

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

export function addComment(projectId: string, c: Omit<Comment, 'id' | 'createdAt' | 'resolved' | 'replies'>): Comment {
  const list = load(projectId);
  const comment: Comment = {
    ...c,
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
  c.replies.push({ author, body, createdAt: new Date().toISOString() });
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

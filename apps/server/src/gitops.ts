import fs from 'node:fs';
import path from 'node:path';
import { worktreesDir } from './config.js';
import { repoDir, branchDir, git } from './store.js';
import { BRANCH_RE } from './util.js';

export interface BranchInfo { name: string; current?: boolean; head: string; message: string; date: string }

export async function listBranches(id: string): Promise<BranchInfo[]> {
  const g = git(repoDir(id));
  const raw = await g.raw(['for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso8601)%09%(contents:subject)']);
  return raw.trim().split('\n').filter(Boolean).map((line) => {
    const [name, head, date, ...msg] = line.split('\t');
    return { name, head, date, message: msg.join('\t') };
  });
}

/** Create branch from a base and materialize its worktree. */
export async function createBranch(id: string, name: string, from = 'main'): Promise<void> {
  if (!BRANCH_RE.test(name) || name.includes('..')) throw new Error('bad branch name');
  if (!BRANCH_RE.test(from) || from.includes('..')) throw new Error('bad base branch name');
  if (name === 'main') throw new Error('main already exists');
  const g = git(repoDir(id));
  const dir = branchDir(id, name);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await g.raw(['worktree', 'add', '-b', name, dir, from]);
}

export async function deleteBranch(id: string, name: string): Promise<void> {
  if (name === 'main') throw new Error('cannot delete main');
  const g = git(repoDir(id));
  const dir = branchDir(id, name);
  try { await g.raw(['worktree', 'remove', '--force', dir]); } catch { /* worktree may be gone */ }
  await g.raw(['branch', '-D', name]);
}

/** Ensure a worktree exists for an already-existing branch (e.g. after container restart). */
export async function ensureWorktree(id: string, name: string): Promise<string> {
  const dir = branchDir(id, name);
  if (name === 'main' || fs.existsSync(dir)) return dir;
  const g = git(repoDir(id));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await g.raw(['worktree', 'add', dir, name]);
  return dir;
}

export async function commitAll(id: string, branch: string, message: string, author?: string): Promise<{ committed: boolean; hash?: string }> {
  const dir = await ensureWorktree(id, branch);
  const g = git(dir);
  await g.add(['-A']);
  const status = await g.status();
  if (status.staged.length === 0 && status.files.length === 0) return { committed: false };
  const opts: Record<string, string | null> = {};
  if (author) opts['--author'] = `${author} <${author.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@papyr.local>`;
  const res = await g.commit(message, undefined, opts);
  return { committed: true, hash: res.commit };
}

export interface LogEntry { hash: string; date: string; message: string; author: string }

export async function log(id: string, branch: string, limit = 50): Promise<LogEntry[]> {
  const g = git(repoDir(id));
  const res = await g.log([branch, `--max-count=${limit}`]);
  return res.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, author: c.author_name }));
}

export interface MergeResult { ok: boolean; conflicts?: string[]; message?: string }

/** Merge `from` into `into`. On conflict: abort and report conflicting files. */
export async function merge(id: string, from: string, into: string, author?: string): Promise<MergeResult> {
  // commit any pending changes in both branches first so the merge sees latest state
  await commitAll(id, from, `papyr: checkpoint before merge`, author).catch(() => {});
  await commitAll(id, into, `papyr: checkpoint before merge`, author).catch(() => {});
  const dir = await ensureWorktree(id, into);
  const g = git(dir);
  try {
    await g.raw(['merge', '--no-ff', '-m', `Merge ${from} into ${into}`, from]);
    return { ok: true };
  } catch (err: any) {
    const status = await g.status();
    const conflicts = status.conflicted;
    await g.raw(['merge', '--abort']).catch(() => {});
    return { ok: false, conflicts, message: String(err?.message || err) };
  }
}

export async function fileDiff(id: string, branch: string, base = 'main'): Promise<string> {
  const g = git(repoDir(id));
  return g.raw(['diff', `${base}...${branch}`, '--stat']);
}

/** Unified patch for a single commit (handles root commits, which have no parent). */
export async function commitDiff(id: string, hash: string): Promise<{ patch: string; stat: string }> {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new Error('bad commit hash');
  const g = git(repoDir(id));
  const patch = await g.raw(['show', hash, '--no-color', '--pretty=format:', '--']);
  const stat = await g.raw(['show', hash, '--no-color', '--stat', '--pretty=format:', '--']);
  return { patch: patch.replace(/^\n+/, ''), stat: stat.replace(/^\n+/, '') };
}

/** Remove stale worktree registrations on boot. */
export async function pruneWorktrees(id: string): Promise<void> {
  try { await git(repoDir(id)).raw(['worktree', 'prune']); } catch { /* noop */ }
}

export function worktreeRoot(id: string): string {
  return path.join(worktreesDir, id);
}

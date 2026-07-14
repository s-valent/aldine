import fs from 'node:fs';
import path from 'node:path';
import { worktreesDir, projectsDir } from './config.js';
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

// ---------- remote sync (GitHub) ----------
// SECURITY: the projects dir is shared with the compiler, so the auth token must
// never land in .git/config. We pass a tokenized URL inline per network op and
// keep only a credential-free URL as `origin`.

/** Strip any `user:token@` credentials from an http(s) URL. */
export function stripCreds(url: string): string {
  return url.replace(/(https?:\/\/)[^@/]+@/i, '$1');
}

/** Clone a remote into a (new) project's repo dir, then scrub the token from origin. */
export async function cloneRepo(id: string, tokenUrl: string): Promise<{ defaultBranch: string }> {
  const dir = repoDir(id);
  if (fs.existsSync(dir)) throw new Error('project already exists');
  fs.mkdirSync(projectsDir, { recursive: true });
  await git(projectsDir).clone(tokenUrl, dir, ['--no-single-branch']);
  const g = git(dir);
  await g.remote(['set-url', 'origin', stripCreds(tokenUrl)]); // never persist the token
  await g.addConfig('user.name', 'Papyr');
  await g.addConfig('user.email', 'papyr@localhost');
  const defaultBranch = (await g.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main';
  return { defaultBranch };
}

/** Push a branch to the remote (same name). Assumes commits already made. */
export async function pushBranch(id: string, branch: string, tokenUrl: string): Promise<void> {
  if (!BRANCH_RE.test(branch)) throw new Error('bad branch name');
  await git(repoDir(id)).raw(['push', tokenUrl, `refs/heads/${branch}:refs/heads/${branch}`]);
}

/** How many commits the local branch is ahead/behind the remote (fetches first). */
export async function syncStatus(id: string, branch: string, tokenUrl: string): Promise<{ ahead: number; behind: number }> {
  if (!BRANCH_RE.test(branch)) throw new Error('bad branch name');
  const g = git(repoDir(id));
  await g.raw(['fetch', tokenUrl, branch]);
  const ahead = Number((await g.raw(['rev-list', '--count', `FETCH_HEAD..refs/heads/${branch}`])).trim()) || 0;
  const behind = Number((await g.raw(['rev-list', '--count', `refs/heads/${branch}..FETCH_HEAD`])).trim()) || 0;
  return { ahead, behind };
}

/** Pull (fetch + merge) the remote branch into the local branch's worktree. Reports conflicts. */
export async function pullBranch(id: string, branch: string, tokenUrl: string): Promise<MergeResult> {
  if (!BRANCH_RE.test(branch)) throw new Error('bad branch name');
  const dir = await ensureWorktree(id, branch);
  const g = git(dir);
  await g.raw(['fetch', tokenUrl, branch]);
  try {
    await g.raw(['merge', '--no-edit', 'FETCH_HEAD']);
    return { ok: true };
  } catch (err: any) {
    const conflicts = (await g.status()).conflicted;
    await g.raw(['merge', '--abort']).catch(() => {});
    return { ok: false, conflicts, message: String(err?.message || err) };
  }
}

/** Remove stale worktree registrations on boot. */
export async function pruneWorktrees(id: string): Promise<void> {
  try { await git(repoDir(id)).raw(['worktree', 'prune']); } catch { /* noop */ }
}

export function worktreeRoot(id: string): string {
  return path.join(worktreesDir, id);
}

import { db } from './db/index.js';

/**
 * GitHub integration: per-user access token (stored in the secrets DataStore,
 * never in the compiler-visible projects dir) + a thin REST client. The token
 * comes from either an OAuth "connect" with repo scope or a pasted PAT.
 */

const API = process.env.GITHUB_API_BASE || 'https://api.github.com';

export interface GithubConnection { token: string; login: string; name?: string }
export interface Repo { fullName: string; name: string; owner: string; private: boolean; defaultBranch: string; cloneUrl: string; updatedAt: string }

/** Whether "Connect with GitHub" (OAuth, repo scope) is configured. PAT connect always works. */
export function oauthEnabled(): boolean {
  return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export async function getConnection(userId: string): Promise<GithubConnection | null> {
  const c = await db().getConnection(userId, 'github');
  return c && typeof c.token === 'string' ? (c as unknown as GithubConnection) : null;
}
export function setConnection(userId: string, conn: GithubConnection): Promise<void> {
  return db().setConnection(userId, 'github', conn as unknown as Record<string, unknown>);
}
export function disconnect(userId: string): Promise<void> {
  return db().deleteConnection(userId, 'github');
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'aldine',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Exchange an OAuth authorization code (repo scope) for an access token. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tok = (await res.json()) as { access_token?: string; error_description?: string };
  if (!tok.access_token) throw new Error(tok.error_description || 'no access token');
  return tok.access_token;
}

/** Authorize URL for connecting a GitHub account with repo scope. */
export function connectUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID!, scope: 'repo', state, redirect_uri: redirectUri });
  return `https://github.com/login/oauth/authorize?${p}`;
}

/** Validate a token and return the authenticated user. */
export async function whoami(token: string): Promise<{ login: string; name?: string }> {
  const u = await api(token, '/user');
  return { login: u.login, name: u.name || u.login };
}

function mapRepo(r: any): Repo {
  return {
    fullName: r.full_name,
    name: r.name,
    owner: r.owner?.login || r.full_name?.split('/')[0],
    private: !!r.private,
    defaultBranch: r.default_branch || 'main',
    cloneUrl: r.clone_url,
    updatedAt: r.updated_at || r.pushed_at || '',
  };
}

/** Repos the user can push to, most-recently-updated first. */
export async function listRepos(token: string): Promise<Repo[]> {
  const list = (await api(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member')) as any[];
  return (list || []).map(mapRepo);
}

export async function getRepo(token: string, owner: string, repo: string): Promise<Repo> {
  return mapRepo(await api(token, `/repos/${owner}/${repo}`));
}

/** Branch names in the repo, most relevant first (default branch bubbled to top). */
export async function listBranches(token: string, owner: string, repo: string): Promise<string[]> {
  const list = (await api(token, `/repos/${owner}/${repo}/branches?per_page=100`)) as Array<{ name: string }>;
  return (list || []).map((b) => b.name);
}

/** Open a pull request; returns its web URL and number. */
export async function createPullRequest(token: string, owner: string, repo: string, opts: { title: string; head: string; base: string; body?: string }): Promise<{ url: string; number: number }> {
  const pr = await api(token, `/repos/${owner}/${repo}/pulls`, { method: 'POST', body: JSON.stringify(opts) });
  return { url: pr.html_url, number: pr.number };
}

/**
 * Inject the token into an https clone URL for a git network op. Non-http URLs
 * (e.g. a local path in tests) are returned unchanged. The result is used
 * inline and never written to .git/config.
 */
export function tokenUrl(cloneUrl: string, token: string): string {
  if (!/^https?:\/\//i.test(cloneUrl)) return cloneUrl;
  return cloneUrl.replace(/^(https?:\/\/)/i, `$1x-access-token:${token}@`);
}

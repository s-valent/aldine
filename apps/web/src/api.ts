export interface ProjectSummary {
  id: string;
  name: string;
  rootFile: string;
  engine: string;
  createdAt: string;
  zotero: { libraryPrefix: string; collectionKey?: string; bibFile: string; lastSyncedAt?: string; username?: string } | null;
}

export interface BranchInfo { name: string; head: string; message: string; date: string }
export interface ProjectDetail extends ProjectSummary { branches: BranchInfo[] }
export interface TreeEntry { path: string; type: 'file' | 'dir'; size?: number; binary?: boolean }
export interface CompileError { type: 'error' | 'warning' | 'typesetting'; line: number | null; message: string }
export interface CompileResult {
  ok: boolean;
  timedOut?: boolean;
  pdf: string | null;
  pdfUrl: string | null;
  log: string;
  errors: CompileError[];
  durationMs: number;
  error?: string;
}
export interface BibEntry { key: string; type: string; author?: string; title?: string; year?: string; journal?: string; file: string }
export interface LogEntry { hash: string; date: string; message: string; author: string }
export interface PluginManifest { id: string; name: string; description?: string; version: string; entry: string; icon?: string; enabled?: boolean }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => req<ProjectSummary[]>('/api/projects'),
  createProject: (name: string, files?: Record<string, string>) =>
    req<ProjectSummary>('/api/projects', { method: 'POST', body: JSON.stringify({ name, files }) }),
  getProject: (id: string) => req<ProjectDetail>(`/api/projects/${id}`),
  patchProject: (id: string, patch: Partial<Pick<ProjectSummary, 'name' | 'rootFile' | 'engine'>>) =>
    req<ProjectSummary>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  listFiles: (id: string, branch: string) => req<TreeEntry[]>(`/api/projects/${id}/files?branch=${encodeURIComponent(branch)}`),
  readFile: async (id: string, branch: string, path: string) => {
    const res = await fetch(`/api/projects/${id}/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  writeFile: (id: string, branch: string, path: string, content: string, encoding: 'utf8' | 'base64' = 'utf8') =>
    req<{ ok: boolean }>(`/api/projects/${id}/file`, { method: 'PUT', body: JSON.stringify({ branch, path, content, encoding }) }),
  deleteFile: (id: string, branch: string, path: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  renameFile: (id: string, branch: string, from: string, to: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/file/rename`, { method: 'POST', body: JSON.stringify({ branch, from, to }) }),

  compile: (id: string, branch: string) =>
    req<CompileResult>(`/api/projects/${id}/compile`, { method: 'POST', body: JSON.stringify({ branch }) }),
  bib: (id: string, branch: string) => req<BibEntry[]>(`/api/projects/${id}/bib?branch=${encodeURIComponent(branch)}`),

  branches: (id: string) => req<BranchInfo[]>(`/api/projects/${id}/branches`),
  createBranch: (id: string, name: string, from: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/branches`, { method: 'POST', body: JSON.stringify({ name, from }) }),
  deleteBranch: (id: string, name: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}/branches?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
  commit: (id: string, branch: string, message: string, author?: string) =>
    req<{ committed: boolean; hash?: string }>(`/api/projects/${id}/commit`, { method: 'POST', body: JSON.stringify({ branch, message, author }) }),
  log: (id: string, branch: string) => req<LogEntry[]>(`/api/projects/${id}/log?branch=${encodeURIComponent(branch)}`),
  merge: (id: string, from: string, into: string, author?: string) =>
    req<{ ok: boolean; conflicts?: string[]; message?: string }>(`/api/projects/${id}/merge`, { method: 'POST', body: JSON.stringify({ from, into, author }) }),

  zoteroValidate: (apiKey: string) =>
    req<{ userID: number; username?: string; groups: Array<{ id: number; name: string }> }>('/api/zotero/validate', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  zoteroCollections: (apiKey: string, libraryPrefix: string) =>
    req<Array<{ key: string; name: string; parent: string | false }>>('/api/zotero/collections', { method: 'POST', body: JSON.stringify({ apiKey, libraryPrefix }) }),
  zoteroLink: (id: string, body: { apiKey: string; libraryPrefix: string; collectionKey?: string; bibFile?: string }) =>
    req<{ ok: boolean; itemCount?: number; bibFile?: string }>(`/api/projects/${id}/zotero/link`, { method: 'POST', body: JSON.stringify(body) }),
  zoteroSync: (id: string, branch: string, force = false) =>
    req<{ synced: boolean; unchanged?: boolean; itemCount?: number; bibFile?: string }>(`/api/projects/${id}/zotero/sync`, { method: 'POST', body: JSON.stringify({ branch, force }) }),
  zoteroUnlink: (id: string) => req<{ ok: boolean }>(`/api/projects/${id}/zotero`, { method: 'DELETE' }),

  plugins: () => req<PluginManifest[]>('/api/plugins'),
};

/** Local identity for presence + commit attribution. */
export function localUser(): { name: string; color: string } {
  let name = localStorage.getItem('papyr.name');
  if (!name) {
    name = `Writer ${Math.floor(100 + Math.random() * 900)}`;
    localStorage.setItem('papyr.name', name);
  }
  const palette = ['#e8554d', '#f0a202', '#2e933c', '#2e62e9', '#8f3ec9', '#d63384', '#0aa2c0'];
  let color = localStorage.getItem('papyr.color');
  if (!color) {
    color = palette[Math.floor(Math.random() * palette.length)];
    localStorage.setItem('papyr.color', color);
  }
  return { name, color };
}

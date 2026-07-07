import path from 'node:path';
import { config } from './config.js';
import { branchDir, readMeta } from './store.js';
import { ensureWorktree } from './gitops.js';
import { flushBranchDocs } from './collab.js';

export interface CompileError { type: 'error' | 'warning' | 'typesetting'; line: number | null; message: string; file?: string }

export interface CompileResult {
  ok: boolean;
  timedOut?: boolean;
  exitCode?: number;
  pdf: string | null;      // path relative to branch dir (.papyr-out/main.pdf)
  pdfUrl: string | null;   // URL the client can fetch
  log: string;
  errors: CompileError[];
  durationMs: number;
  error?: string;
}

/** projectDir sent to the compiler is relative to the shared data volume root. */
function relProjectDir(projectId: string, branch: string): string {
  return path.relative(config.dataDir, branchDir(projectId, branch));
}

export async function compileProject(projectId: string, branch: string): Promise<CompileResult> {
  const meta = readMeta(projectId);
  await ensureWorktree(projectId, branch);
  flushBranchDocs(projectId, branch);

  const res = await fetch(`${config.compilerUrl}/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectDir: relProjectDir(projectId, branch),
      rootFile: meta.rootFile,
      engine: meta.engine,
    }),
  });
  const body = (await res.json()) as Omit<CompileResult, 'pdfUrl'>;
  const pdfUrl = body.pdf
    ? `/api/projects/${projectId}/output?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(body.pdf)}&t=${Date.now()}`
    : null;
  return { ...body, pdfUrl };
}

export async function synctexLookup(projectId: string, branch: string, payload: Record<string, unknown>): Promise<unknown> {
  const meta = readMeta(projectId);
  const res = await fetch(`${config.compilerUrl}/synctex`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectDir: relProjectDir(projectId, branch),
      rootFile: meta.rootFile,
      ...payload,
    }),
  });
  return res.json();
}

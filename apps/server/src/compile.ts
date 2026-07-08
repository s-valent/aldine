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

/**
 * Serialize compiles per project::branch so two clients can't run latexmk in
 * the same .papyr-out dir concurrently (which corrupts aux files / the PDF).
 * A queued request coalesces onto the in-flight one's successor.
 */
const compileChain = new Map<string, Promise<unknown>>();

export function compileProject(projectId: string, branch: string): Promise<CompileResult> {
  const key = `${projectId}::${branch}`;
  const prev = compileChain.get(key) || Promise.resolve();
  const result = prev.catch(() => undefined).then(() => runCompile(projectId, branch));
  // The chain tail must never reject (would surface as an unhandled rejection);
  // the caller gets `result` (which may reject and is awaited/handled by the route).
  const tail = result.catch(() => undefined).then(() => {
    if (compileChain.get(key) === tail) compileChain.delete(key);
  });
  compileChain.set(key, tail);
  return result;
}

async function runCompile(projectId: string, branch: string): Promise<CompileResult> {
  const meta = await readMeta(projectId);
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
  const raw = (await res.json()) as Partial<Omit<CompileResult, 'pdfUrl'>> & { error?: string };
  // Normalize: the compiler may return a bare {ok:false,error} on a 4xx — always
  // hand the client a well-formed CompileResult so the UI never sees undefined fields.
  const body: Omit<CompileResult, 'pdfUrl'> = {
    ok: !!raw.ok,
    timedOut: raw.timedOut,
    exitCode: raw.exitCode,
    pdf: raw.pdf ?? null,
    log: raw.log ?? (raw.error ? `Compiler error: ${raw.error}` : ''),
    errors: Array.isArray(raw.errors) ? raw.errors : [],
    durationMs: raw.durationMs ?? 0,
    error: raw.error,
  };
  const pdfUrl = body.pdf
    ? `/api/projects/${projectId}/output?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(body.pdf)}&t=${Date.now()}`
    : null;
  return { ...body, pdfUrl };
}

export async function synctexLookup(projectId: string, branch: string, payload: Record<string, unknown>): Promise<unknown> {
  const meta = await readMeta(projectId);
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

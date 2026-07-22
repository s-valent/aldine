import { api, BibEntry } from '../../api';
import { pokeViews } from './refresh';

/**
 * Project context for widgets that need more than the document text (cite
 * labels from the bibliography, image URLs). Set by visualExtensions() when a
 * pane mounts; decoration building itself stays pure.
 */
let ctx: { projectId: string; branch: string } | null = null;
let bib: BibEntry[] | null = null;
let bibKey = '';

export function setVisualContext(projectId: string, branch: string): void {
  ctx = { projectId, branch };
  const key = `${projectId}::${branch}`;
  if (key !== bibKey) {
    bibKey = key;
    bib = null;
    api.bib(projectId, branch)
      .then((entries) => { bib = entries; pokeViews(); })
      .catch(() => { bib = []; });
  }
}

/** "(Knuth 1984; Lamport 1994)" for a comma-separated key list, best effort. */
export function citeLabel(keys: string): string | null {
  if (!bib) return null;
  const parts = keys.split(',').map((k) => k.trim()).filter(Boolean).map((key) => {
    const e = bib!.find((b) => b.key === key);
    if (!e) return key;
    const surname = (e.author || '').split(/\s+and\s+|,/)[0].trim().split(/\s+/).pop() || key;
    return e.year ? `${surname} ${e.year}` : surname;
  });
  return parts.length ? parts.join('; ') : null;
}

/** Raw file URL inside the current project (for figure image previews). */
export function fileUrl(path: string): string | null {
  if (!ctx) return null;
  return `/api/projects/${ctx.projectId}/file?branch=${encodeURIComponent(ctx.branch)}&path=${encodeURIComponent(path)}`;
}

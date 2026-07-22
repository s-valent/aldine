import type { EditorView } from '@codemirror/view';

/**
 * Lazy KaTeX: loaded (with its CSS) only when visual mode first renders math,
 * as its own Vite chunk — the source-mode bundle is untouched. Until the
 * module arrives, math widgets show styled raw source; registered views get a
 * re-measure poke when rendering becomes available.
 */
type Katex = typeof import('katex').default;

let katex: Katex | null = null;
let loading: Promise<void> | null = null;
const views = new Set<EditorView>();

export function registerView(view: EditorView): void {
  views.add(view);
}
export function unregisterView(view: EditorView): void {
  views.delete(view);
}

export function ensureKatex(): void {
  if (katex || loading) return;
  // @ts-expect-error -- CSS import is handled by Vite, not TS
  loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    .then(([mod]) => {
      katex = mod.default;
      for (const v of views) v.requestMeasure();
      // widgets compare by source string; force a redraw so toDOM reruns
      for (const v of views) v.dispatch({});
    })
    .catch(() => { loading = null; });
}

const cache = new Map<string, string>();
const CACHE_MAX = 500;

/** Rendered HTML for a math source, or null while KaTeX is still loading. */
export function renderMath(source: string, displayMode: boolean): string | null {
  if (!katex) { ensureKatex(); return null; }
  const key = `${displayMode ? 'D' : 'I'}:${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(source, { displayMode, throwOnError: false, output: 'html' });
  } catch {
    return ''; // signals render failure → widget falls back to raw source
  }
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, html);
  return html;
}

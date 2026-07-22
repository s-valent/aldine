import type { EditorView } from '@codemirror/view';

/**
 * Registry of live visual-mode views, so async resources (KaTeX, bibliography,
 * MathLive) can poke a redraw when they arrive.
 */
const views = new Set<EditorView>();

export function registerView(view: EditorView): void {
  views.add(view);
}
export function unregisterView(view: EditorView): void {
  views.delete(view);
}
export function pokeViews(): void {
  for (const v of views) v.dispatch({});
}

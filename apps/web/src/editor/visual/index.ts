import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { revealField } from './reveal';
import { atomicField } from './atomicField';
import { markPlugin } from './markPlugin';
import { visualTheme } from './theme';
import { ensureKatex, registerView, unregisterView } from './katex';
import { remoteCaretReveal } from './remoteCarets';

/** Clicking a rendered widget puts the caret inside its construct → reveal. */
const widgetClick = EditorView.domEventHandlers({
  mousedown(e, view) {
    const t = (e.target as HTMLElement).closest?.('[data-pos].cm-vis-math, [data-pos].cm-vis-chip') as HTMLElement | null;
    if (!t?.dataset.pos) return false;
    const pos = Math.min(Number(t.dataset.pos) + 1, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
    return true;
  },
});

/** Kick the lazy KaTeX chunk and keep the view re-measurable when it lands. */
const katexLifecycle = ViewPlugin.define((view) => {
  registerView(view);
  ensureKatex();
  return { destroy: () => unregisterView(view) };
});

/** Everything the visual mode needs from the hosting CodePane. */
export interface VisualDeps {
  projectId: string;
  branch: string;
  ydoc: Y.Doc;
  awareness: Awareness;
}

/**
 * The Visual editing mode: a pure decoration layer over the shared Y.Text.
 * It never dispatches document changes — source bytes are only ever modified
 * by explicit user edits and the formatting commands in ./commands.ts.
 */
export function visualExtensions(deps: VisualDeps): Extension {
  return [revealField, atomicField, markPlugin, visualTheme, widgetClick, katexLifecycle, remoteCaretReveal(deps.awareness)];
}

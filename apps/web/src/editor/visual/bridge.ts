import { ViewPlugin } from '@codemirror/view';

/**
 * Widgets are plain DOM with no EditorView reference; this bridge turns their
 * window events into precise CM dispatches (which flow through yCollab/undo).
 */
export const docEditBridge = ViewPlugin.define((view) => {
  const onEdit = (e: Event) => {
    const { from, to, insert } = (e as CustomEvent<{ from: number; to: number; insert: string }>).detail;
    const len = view.state.doc.length;
    if (from < 0 || to > len || from > to) return;
    view.dispatch({ changes: { from, to, insert }, userEvent: 'input.visual' });
  };
  const onGoto = (e: Event) => {
    const { pos } = (e as CustomEvent<{ pos: number }>).detail;
    view.dispatch({ selection: { anchor: Math.min(Math.max(0, pos), view.state.doc.length) }, scrollIntoView: true });
    view.focus();
  };
  window.addEventListener('aldine:doc-edit', onEdit);
  window.addEventListener('aldine:goto', onGoto);
  return {
    destroy() {
      window.removeEventListener('aldine:doc-edit', onEdit);
      window.removeEventListener('aldine:goto', onGoto);
    },
  };
});

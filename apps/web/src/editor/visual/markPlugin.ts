import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { revealField, RevealState } from './reveal';
import { buildMarks } from './decorations';

/** Viewport-only styling marks (headings, bold, italic, …). */
export const markPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private forReveal: RevealState;

    constructor(view: EditorView) {
      this.forReveal = view.state.field(revealField);
      this.decorations = buildMarks(view.state, this.forReveal.ranges, view.visibleRanges);
    }

    update(u: ViewUpdate) {
      const rv = u.state.field(revealField);
      if (u.docChanged || u.viewportChanged || rv !== this.forReveal) {
        this.forReveal = rv;
        this.decorations = buildMarks(u.state, rv.ranges, u.view.visibleRanges);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

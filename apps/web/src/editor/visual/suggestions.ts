import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { setComments, CommentRange } from '../commentsEffect';

/**
 * Inline tracked changes: an unresolved review comment carrying a suggestion
 * renders as strikethrough over the original text plus the proposed
 * replacement with accept/dismiss controls — Word-style track changes over
 * LaTeX. Accepting routes through the exact same API as the Review panel.
 */
class SuggestionWidget extends WidgetType {
  constructor(readonly id: string, readonly text: string) {
    super();
  }

  eq(other: SuggestionWidget): boolean {
    return other.id === this.id && other.text === this.text;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-vis-suggest';
    el.setAttribute('data-testid', 'vis-suggest');
    const ins = document.createElement('span');
    ins.className = 'cm-vis-suggest__ins';
    ins.textContent = this.text;
    el.appendChild(ins);
    const mk = (label: string, title: string, action: 'accept' | 'resolve') => {
      const b = document.createElement('button');
      b.className = 'cm-vis-suggest__btn';
      b.textContent = label;
      b.title = title;
      b.setAttribute('data-testid', `vis-suggest-${action}`);
      b.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('aldine:suggestion', { detail: { id: this.id, action } }));
      };
      el.appendChild(b);
    };
    mk('✓', 'Accept suggestion', 'accept');
    mk('✕', 'Dismiss', 'resolve');
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const strike = Decoration.mark({ class: 'cm-vis-strike' });

interface SuggestState { ranges: CommentRange[]; deco: DecorationSet }

function build(ranges: CommentRange[], docLen: number): DecorationSet {
  const active = ranges
    .filter((r) => !r.resolved && r.suggestion != null && r.from < r.to && r.to <= docLen)
    .sort((a, b) => a.from - b.from);
  const decos = [];
  for (const r of active) {
    decos.push(strike.range(r.from, r.to));
    decos.push(Decoration.widget({ widget: new SuggestionWidget(r.id, r.suggestion!), side: 1 }).range(r.to));
  }
  return Decoration.set(decos, true);
}

export const suggestField = StateField.define<SuggestState>({
  create() {
    return { ranges: [], deco: Decoration.none };
  },
  update(value, tr) {
    let ranges = value.ranges;
    let changed = false;
    for (const e of tr.effects) {
      if (e.is(setComments)) {
        ranges = e.value;
        changed = true;
      }
    }
    if (tr.docChanged) {
      // Ranges can arrive before the Yjs doc has synced (doc still empty);
      // leave anything that doesn't fit the pre-change doc unmapped — build()
      // only renders ranges valid for the current doc, so they light up once
      // the content lands instead of crashing the changeset mapping.
      const startLen = tr.startState.doc.length;
      ranges = ranges.map((r) =>
        r.from <= startLen && r.to <= startLen
          ? { ...r, from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to, 1) }
          : r,
      );
      changed = true;
    }
    if (!changed) return value;
    return { ranges, deco: build(ranges, tr.state.doc.length) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

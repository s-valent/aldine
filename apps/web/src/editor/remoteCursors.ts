import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { Annotation, RangeSet, type Extension } from '@codemirror/state';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { yRemoteSelectionsTheme } from 'y-codemirror.next';

/**
 * Remote cursor/selection rendering, replacing y-codemirror.next's built-in
 * yRemoteSelections (bundled into yCollab).
 *
 * WebKit (Safari) caches the painted content of text lines and doesn't always
 * invalidate it when a caret widget is removed, leaving a ghost at every spot a
 * remote cursor has passed. The upstream caret also paints above its own line
 * (absolute name label at top: -1.05em), which is exactly the region that
 * ghosted. Here the caret is a plain inline bar that never leaves its line, and
 * every update forces a re-render of the caret line AND the line above it (for
 * both the current and the previous caret position), so the cached paint of the
 * old spot is discarded.
 */
class RemoteCaret extends WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
  ) {
    super();
  }

  eq() {
    // recreate the DOM on every change so the old node is always removed
    return false;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'ycaret';
    span.style.background = this.color;
    const label = document.createElement('span');
    label.className = 'ycaret__name';
    label.style.background = this.color;
    label.textContent = this.name;
    span.appendChild(label);
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

const remoteCursorAnnotation = Annotation.define<null>();
const redrawMark = Decoration.mark({ class: 'cm-yRedraw' });

/** Collaborative remote carets + selection ranges, sent and rendered via awareness. */
export function remoteCursors(ytext: Y.Text, awareness: Awareness): Extension[] {
  class RemoteCursorPlugin {
    decorations: DecorationSet = RangeSet.of([]);
    private prevCaretLines = new Map<number, number>();
    private readonly dispatchListener = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated).concat(removed);
      // only re-render on REMOTE changes — our own cursor moves re-enter via update()
      if (changed.findIndex((id) => id !== awareness.doc.clientID) >= 0) {
        this.view.dispatch({ annotations: [remoteCursorAnnotation.of(null)] });
      }
    };

    constructor(private readonly view: EditorView) {
      awareness.on('change', this.dispatchListener);
    }

    update(update: ViewUpdate) {
      // publish our own cursor (relative positions, only while focused)
      const localState = awareness.getLocalState();
      if (localState != null) {
        const hasFocus = update.view.hasFocus && update.view.dom.ownerDocument.hasFocus();
        const sel = hasFocus ? update.state.selection.main : null;
        const cur = (localState as { cursor?: any }).cursor;
        const currentAnchor = cur?.anchor ? Y.createRelativePositionFromJSON(cur.anchor) : null;
        const currentHead = cur?.head ? Y.createRelativePositionFromJSON(cur.head) : null;
        if (sel != null) {
          const anchor = Y.createRelativePositionFromTypeIndex(ytext, sel.anchor);
          const head = Y.createRelativePositionFromTypeIndex(ytext, sel.head);
          if (!cur || !Y.compareRelativePositions(currentAnchor, anchor) || !Y.compareRelativePositions(currentHead, head)) {
            awareness.setLocalStateField('cursor', { anchor, head });
          }
        } else if (cur != null && hasFocus) {
          awareness.setLocalStateField('cursor', null);
        }
      }

      const doc = update.view.state.doc;
      const redrawLines = new Set<number>();
      const caretLines = new Map<number, number>();
      const decorations: { from: number; to: number; value: Decoration }[] = [];

      // one cursor per account — a user's previous session keeps its own clientID.
      // the account key may be absent on sessions started before it existed; the
      // email name is then a safe fallback (guest "Writer N" names never contain @)
      const accountOf = (s: { user?: { account?: string; name?: string } }) => {
        const u = s.user;
        if (u?.account) return u.account;
        if (u?.name && u.name.includes('@')) return u.name;
        return undefined;
      };
      const byAccount = new Map<string, number>();
      awareness.getStates().forEach((s, clientId) => {
        if (clientId === awareness.doc.clientID) return;
        const account = accountOf(s);
        if (!account) return;
        const prev = byAccount.get(account);
        const stampOf = (id: number) => {
          const m = awareness.meta.get(id);
          return m ? m.lastUpdated * 100000 + m.clock : 0;
        };
        if (prev === undefined || stampOf(clientId) > stampOf(prev)) byAccount.set(account, clientId);
      });

      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.doc.clientID) return;
        const account = accountOf(state);
        if (account && byAccount.get(account) !== clientId) return;
        const cursor = (state as { cursor?: any }).cursor;
        if (!cursor?.anchor || !cursor?.head) return;
        const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ytext.doc!);
        const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, ytext.doc!);
        if (!anchor || !head || anchor.type !== ytext || head.type !== ytext) return;
        const user = (state as { user?: { color?: string; colorLight?: string; name?: string } }).user || {};
        const color = user.color || '#30bced';
        const colorLight = user.colorLight || `${color}33`;
        const name = user.name || 'Anonymous';
        const start = Math.min(anchor.index, head.index);
        const end = Math.max(anchor.index, head.index);
        const startLine = doc.lineAt(start);
        const endLine = doc.lineAt(end);
        const mark = () => Decoration.mark({ attributes: { style: `background-color: ${colorLight}` }, class: 'cm-ySelection' });
        if (startLine.number === endLine.number) {
          decorations.push({ from: start, to: end, value: mark() });
        } else {
          decorations.push({ from: start, to: startLine.from + startLine.length, value: mark() });
          decorations.push({ from: endLine.from, to: end, value: mark() });
          for (let i = startLine.number + 1; i < endLine.number; i++) {
            const linePos = doc.line(i).from;
            decorations.push({ from: linePos, to: linePos, value: Decoration.line({ attributes: { style: `background-color: ${colorLight}` } }) });
          }
        }
        const headLineNo = doc.lineAt(head.index).number;
        redrawLines.add(headLineNo);
        if (headLineNo > 1) redrawLines.add(headLineNo - 1);
        caretLines.set(clientId, headLineNo);
        decorations.push({
          from: head.index,
          to: head.index,
          value: Decoration.widget({
            key: String(clientId), // stable identity per collaborator
            side: head.index - anchor.index > 0 ? -1 : 1,
            block: false,
            widget: new RemoteCaret(color, name),
          }),
        });
      });

      // discard cached paint where a caret used to sit (line + the one above);
      // keep entries for sessions that just stopped rendering (disconnect/dedupe)
      for (const lineNo of this.prevCaretLines.values()) {
        redrawLines.add(lineNo);
        if (lineNo > 1) redrawLines.add(lineNo - 1);
      }
      for (const [clientId, lineNo] of caretLines) this.prevCaretLines.set(clientId, lineNo);
      for (const clientId of [...this.prevCaretLines.keys()]) {
        if (!caretLines.has(clientId)) this.prevCaretLines.delete(clientId);
      }

      // the empty mark forces CodeMirror to re-render those lines' DOM
      for (const lineNo of redrawLines) {
        const n = Math.max(1, Math.min(lineNo, doc.lines));
        const line = doc.line(n);
        decorations.push({ from: line.from, to: line.to, value: redrawMark });
      }

      this.decorations = Decoration.set(decorations, true);
    }

    destroy() {
      awareness.off('change', this.dispatchListener);
    }
  }

  return [yRemoteSelectionsTheme, ViewPlugin.fromClass(RemoteCursorPlugin, { decorations: (v) => v.decorations })];
}

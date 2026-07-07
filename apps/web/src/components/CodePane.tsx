import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentOnInput, bracketMatching, foldGutter, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { latex } from 'codemirror-lang-latex';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { localUser } from '../api';
import { citeCompletionSource, refCompletionSource } from '../editor/latexExtras';
import type { PresenceUser } from './Presence';

export interface CodePaneHandle {
  gotoLine(line: number): void;
  insertAtCursor(text: string): void;
}

interface Props {
  projectId: string;
  branch: string;
  filePath: string;
  onUsers(users: PresenceUser[]): void;
  onSave(): void;
}

const papyrTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-panel)',
    border: '1px solid var(--hairline)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-pop)',
    fontFamily: 'var(--font-ui)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  '.cm-completionDetail': { fontStyle: 'normal', opacity: 0.65, fontSize: '11px' },
  '.cm-panels': { backgroundColor: 'var(--bg-inset)', color: 'var(--text)', borderColor: 'var(--hairline)' },
});

const CodePane = forwardRef<CodePaneHandle, Props>(function CodePane({ projectId, branch, filePath, onUsers, onSave }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useImperativeHandle(ref, () => ({
    gotoLine(line: number) {
      const view = viewRef.current;
      if (!view) return;
      const l = Math.min(Math.max(1, line), view.state.doc.lines);
      const pos = view.state.doc.line(l).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      view.focus();
    },
    insertAtCursor(text: string) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    const docName = `${projectId}::${branch}::${filePath}`;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${proto}//${location.host}/collab`,
      name: docName,
      document: ydoc,
    });
    const ytext = ydoc.getText('content');
    const user = localUser();
    provider.setAwarenessField('user', { name: user.name, color: user.color, colorLight: user.color + '55' });

    const awareness = provider.awareness!;
    const reportUsers = () => {
      const states = Array.from(awareness.getStates().values());
      const seen = new Map<string, PresenceUser>();
      for (const s of states) {
        const u = (s as { user?: PresenceUser }).user;
        if (u?.name && !seen.has(u.name)) seen.set(u.name, u);
      }
      onUsers(Array.from(seen.values()));
    };
    awareness.on('change', reportUsers);
    reportUsers();

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          autocompletion(),
          // enableAutocomplete:false skips the package's autocompletion({override}) which
          // would disable ALL languageData sources (incl. our cite/ref completions);
          // its builtin command completions still register via languageData.
          latex({ autoCloseTags: true, enableLinting: false, enableAutocomplete: false }),
          citeCompletionSource(projectId, branch),
          refCompletionSource(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...yUndoManagerKeymap,
            ...completionKeymap,
            indentWithTab,
            { key: 'Mod-s', run: () => { onSave(); return true; } },
          ]),
          papyrTheme,
          EditorView.lineWrapping,
          yCollab(ytext, provider.awareness),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      awareness.off('change', reportUsers);
      view.destroy();
      provider.destroy();
      ydoc.destroy();
      viewRef.current = null;
    };
  }, [projectId, branch, filePath]);

  return <div ref={hostRef} className="code-pane" data-testid="code-pane" />;
});

export default CodePane;

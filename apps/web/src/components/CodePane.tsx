import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentOnInput, bracketMatching, foldGutter, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
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
  currentLine(): number | null;
}

interface Props {
  projectId: string;
  branch: string;
  filePath: string;
  onUsers(users: PresenceUser[]): void;
  onSave(): void;
  onDocChanged?(): void;
  onStats?(stats: { words: number; selWords: number | null }): void;
  onJumpToPdf?(): void;
}

/** Approximate word count for LaTeX prose: strips comments, commands, math. */
export function latexWordCount(src: string): number {
  const stripped = src
    .replace(/(^|[^\\])%.*$/gm, '$1')            // comments
    .replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' EQN ') // math counts as one word
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])*/g, ' ')   // commands (keep brace contents)
    .replace(/[{}~]/g, ' ');
  const words = stripped.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return words ? words.length : 0;
}

/** Calm, ink-blue syntax palette that flips with the color scheme via CSS vars. */
const papyrHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.tagName, t.macroName, t.function(t.variableName)], color: 'var(--syn-command)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.attributeValue, t.inserted], color: 'var(--syn-string)' },
  { tag: [t.number, t.literal, t.bool, t.escape], color: 'var(--syn-value)' },
  { tag: [t.labelName, t.typeName, t.attributeName], color: 'var(--syn-value)' },
  { tag: [t.heading], fontWeight: '600', color: 'var(--text)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: [t.processingInstruction, t.meta, t.bracket], color: 'var(--text-2)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
]);

const papyrTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg-panel)', color: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
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

const CodePane = forwardRef<CodePaneHandle, Props>(function CodePane({ projectId, branch, filePath, onUsers, onSave, onDocChanged, onStats, onJumpToPdf }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef({ onDocChanged, onStats, onSave, onJumpToPdf });
  cbRef.current = { onDocChanged, onStats, onSave, onJumpToPdf };

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
    currentLine() {
      const view = viewRef.current;
      if (!view) return null;
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current) return;
    let statsTimer: ReturnType<typeof setTimeout> | null = null;
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
      // key by Yjs clientID so two collaborators with the same display name stay distinct
      const byClient = new Map<number, PresenceUser>();
      awareness.getStates().forEach((s, clientId) => {
        const u = (s as { user?: PresenceUser }).user;
        if (u?.name) byClient.set(clientId, u);
      });
      onUsers(Array.from(byClient.values()));
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
          syntaxHighlighting(papyrHighlight),
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
            { key: 'Mod-s', run: () => { cbRef.current.onSave(); return true; } },
            { key: 'Mod-j', run: () => { cbRef.current.onJumpToPdf?.(); return true; } },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbRef.current.onDocChanged?.();
            if (u.docChanged || u.selectionSet) {
              if (statsTimer) clearTimeout(statsTimer);
              statsTimer = setTimeout(() => {
                const state = viewRef.current?.state;
                if (!state || !cbRef.current.onStats) return;
                const sel = state.selection.main;
                cbRef.current.onStats({
                  words: latexWordCount(state.doc.toString()),
                  selWords: sel.empty ? null : latexWordCount(state.sliceDoc(sel.from, sel.to)),
                });
              }, 350);
            }
          }),
          papyrTheme,
          EditorView.lineWrapping,
          yCollab(ytext, provider.awareness),
        ],
      }),
    });
    viewRef.current = view;

    const initialStats = () => {
      cbRef.current.onStats?.({ words: latexWordCount(view.state.doc.toString()), selWords: null });
    };
    provider.on('synced', initialStats);

    return () => {
      if (statsTimer) clearTimeout(statsTimer);
      provider.off('synced', initialStats);
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

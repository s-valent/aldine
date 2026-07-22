import { EditorView } from '@codemirror/view';

/**
 * Visual-mode presentation: prose in the serif stack, rendered headings and
 * styles, editor chrome (gutters) tucked away. Colors ride the app CSS vars so
 * light/dark just work.
 */
export const visualTheme = EditorView.theme({
  '&': { fontFamily: 'var(--font-serif)', fontSize: '16px' },
  '.cm-content': { maxWidth: '46em', margin: '0 auto', padding: '24px 32px', lineHeight: '1.65' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },

  '.cm-vis-h': { fontFamily: 'var(--font-ui)', fontWeight: '650', lineHeight: '1.3' },
  '.cm-vis-h1': { fontSize: '1.6em', paddingTop: '0.6em' },
  '.cm-vis-h2': { fontSize: '1.35em', paddingTop: '0.5em' },
  '.cm-vis-h3': { fontSize: '1.15em', paddingTop: '0.4em' },
  '.cm-vis-h4': { fontSize: '1em', paddingTop: '0.3em' },

  '.cm-vis-b': { fontWeight: '700' },
  '.cm-vis-i': { fontStyle: 'italic' },
  '.cm-vis-u': { textDecoration: 'underline' },
  '.cm-vis-sc': { fontVariant: 'small-caps' },

  '.cm-vis-math': { cursor: 'pointer', borderRadius: '4px', padding: '0 1px' },
  '.cm-vis-math:hover': { background: 'var(--accent-soft)' },
  '.cm-vis-math--display': { display: 'block', textAlign: 'center', padding: '8px 0' },
  '.cm-vis-math--raw': { fontFamily: 'var(--font-mono)', fontSize: '0.85em', color: 'var(--syn-command)' },
});

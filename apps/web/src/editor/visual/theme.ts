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

  '.cm-vis-chip': {
    display: 'inline-flex', alignItems: 'baseline', gap: '5px', cursor: 'pointer',
    border: '1px solid var(--hairline)', borderRadius: '6px', padding: '1px 8px',
    background: 'var(--bg-inset)', fontFamily: 'var(--font-ui)', fontSize: '0.8em',
  },
  '.cm-vis-chip:hover': { borderColor: 'var(--hairline-strong)', background: 'var(--bg-hover)' },
  '.cm-vis-chip__kind': { textTransform: 'uppercase', fontSize: '0.75em', fontWeight: '700', color: 'var(--text-3)', letterSpacing: '0.06em' },
  '.cm-vis-chip--cite': { color: 'var(--accent)' },
  '.cm-vis-chip--ref': { color: 'var(--accent)' },
  '.cm-vis-item': { color: 'var(--text-2)', paddingRight: '2px' },
  '.cm-vis-li': { paddingLeft: '1.4em' },
});

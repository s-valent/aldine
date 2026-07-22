import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { RevealRange, intersectsReveal } from './reveal';
import { MathWidget } from './widgets/math';

/** Copied from codemirror-lang-latex (internal SECTION_RANK, not exported). */
export const SECTION_RANK: Record<string, number> = {
  Book: 1, Part: 1, Chapter: 1,
  Section: 1, SubSection: 2, SubSubSection: 3,
  Paragraph: 4, SubParagraph: 4,
};

const STYLE_CLASS: Record<string, string> = {
  TextBoldCommand: 'cm-vis-b',
  TextItalicCommand: 'cm-vis-i',
  EmphasisCommand: 'cm-vis-i',
  UnderlineCommand: 'cm-vis-u',
  TextSmallCapsCommand: 'cm-vis-sc',
};

const hide = Decoration.replace({});
const styleMarks = Object.fromEntries(
  Object.entries(STYLE_CLASS).map(([k, cls]) => [k, Decoration.mark({ class: cls })]),
) as Record<string, Decoration>;
const headingLines = [1, 2, 3, 4].map((n) => Decoration.line({ class: `cm-vis-h cm-vis-h${n}` }));

export interface WalkEmit {
  /** Decoration.replace/widget material + atomic ranges (full-doc StateField). */
  atomic(from: number, to: number, deco: Decoration): void;
  /** Styling marks / line classes (viewport ViewPlugin). */
  mark(from: number, to: number, deco: Decoration): void;
}

/**
 * Extract renderable math from a math node, or null if `name` isn't math or
 * the construct is incomplete. Equation-array content is wrapped in `aligned`
 * so KaTeX can typeset the `&`/`\\` alignment.
 */
function mathParts(name: string, node: SyntaxNode, doc: { sliceString(from: number, to: number): string }): { source: string; display: boolean } | null {
  const slice = (a: number, b: number) => doc.sliceString(a, b).trim();
  if (name === 'DollarMath') {
    const inner = node.getChild('InlineMath') ?? node.getChild('DisplayMath');
    const dollars = node.getChildren('Dollar');
    if (!inner || dollars.length < 2) return null;
    return { source: slice(inner.from, inner.to), display: inner.name === 'DisplayMath' };
  }
  if (name === 'BracketMath' || name === 'ParenMath') {
    const open = node.getChild(name === 'BracketMath' ? 'OpenBracketMath' : 'OpenParenMath');
    const close = node.getChild(name === 'BracketMath' ? 'CloseBracketMath' : 'CloseParenMath');
    if (!open || !close) return null;
    return { source: slice(open.to, close.from), display: name === 'BracketMath' };
  }
  if (name === 'EquationEnvironment' || name === 'EquationArrayEnvironment') {
    const begin = node.getChild('BeginEnv');
    const end = node.getChild('EndEnv');
    if (!begin || !end || end.to !== node.to) return null;
    const body = slice(begin.to, end.from);
    return {
      source: name === 'EquationArrayEnvironment' ? `\\begin{aligned}${body}\\end{aligned}` : body,
      display: true,
    };
  }
  return null;
}

/**
 * The argument interior of a `\cmd{...}` wrapper: returns the hide ranges for
 * `\cmd{` and `}` plus the interior span — or null when the construct is
 * incomplete (unclosed brace ⇒ leave as raw source).
 */
function wrapperParts(node: SyntaxNode, argName: string) {
  const arg = node.getChild(argName);
  const open = arg?.getChild('OpenBrace');
  const close = arg?.getChild('CloseBrace');
  if (!arg || !open || !close || close.to !== node.to) return null;
  return { openEnd: open.to, closeFrom: close.from, closeTo: close.to };
}

/**
 * Single tree walk over [from,to] emitting visual decorations. Whitelist-only:
 * anything not positively matched (unknown commands, ⚠ errors, unclosed
 * constructs) stays raw source. Verbatim subtrees are never entered. Nodes
 * intersecting a reveal range are skipped (their source shows).
 */
export function walk(state: EditorState, reveals: readonly RevealRange[], from: number, to: number, emit: WalkEmit): void {
  const doc = state.doc;
  syntaxTree(state).iterate({
    from,
    to,
    enter(n) {
      if (n.name === 'VerbatimEnvironment') return false;
      if (n.name === 'Comment') return false;

      const rank = SECTION_RANK[n.name];
      if (rank) {
        const cmd = n.node.getChild('SectioningCommand');
        if (!cmd || intersectsReveal(reveals, cmd.from, cmd.to)) return;
        const parts = wrapperParts(cmd, 'SectioningArgument');
        if (!parts || parts.closeTo !== cmd.to) return;
        emit.atomic(cmd.from, parts.openEnd, hide);
        emit.atomic(parts.closeFrom, parts.closeTo, hide);
        emit.mark(doc.lineAt(cmd.from).from, doc.lineAt(cmd.from).from, headingLines[rank - 1]);
        return; // children of the heading argument render as plain heading text
      }

      const math = mathParts(n.name, n.node, doc);
      if (math) {
        if (intersectsReveal(reveals, n.from, n.to)) return false;
        emit.atomic(n.from, n.to, Decoration.replace({ widget: new MathWidget(math.source, math.display, n.from) }));
        return false; // math interior is the widget's business
      }

      const styleMark = styleMarks[n.name];
      if (styleMark) {
        if (intersectsReveal(reveals, n.from, n.to)) return;
        const parts = wrapperParts(n.node, 'TextArgument');
        if (!parts) return;
        emit.atomic(n.from, parts.openEnd, hide);
        emit.atomic(parts.closeFrom, parts.closeTo, hide);
        if (parts.openEnd < parts.closeFrom) emit.mark(parts.openEnd, parts.closeFrom, styleMark);
        return; // interior may nest further styles; walk continues into it
      }
    },
  });
}

/** Full-document atomic set (replace decorations). */
export function buildAtomic(state: EditorState, reveals: readonly RevealRange[]): DecorationSet {
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  walk(state, reveals, 0, state.doc.length, {
    atomic: (from, to, deco) => { if (from < to) ranges.push({ from, to, deco }); },
    mark: () => {},
  });
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const b = new RangeSetBuilder<Decoration>();
  for (const r of ranges) b.add(r.from, r.to, r.deco);
  return b.finish();
}

/** Viewport mark/line set for the given visible ranges. */
export function buildMarks(state: EditorState, reveals: readonly RevealRange[], visible: readonly { from: number; to: number }[]): DecorationSet {
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];
  for (const v of visible) {
    walk(state, reveals, v.from, v.to, {
      atomic: () => {},
      mark: (from, to, deco) => ranges.push({ from, to, deco }),
    });
  }
  // line decorations are zero-length at line start and must precede marks there
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const b = new RangeSetBuilder<Decoration>();
  let prev: { from: number; to: number } | null = null;
  for (const r of ranges) {
    if (prev && prev.from === r.from && prev.to === r.to) continue; // dedupe overlapping viewport chunks
    b.add(r.from, r.to, r.deco);
    prev = r;
  }
  return b.finish();
}

export { WidgetType };

import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { Extension, EditorState } from '@codemirror/state';
import { api, BibEntry } from '../api';

/**
 * \cite{...} and \ref{...} autocomplete.
 * Registered via languageData so they compose with codemirror-lang-latex's
 * built-in command/environment completions instead of replacing them.
 */
const CITE_RE = /\\(?:no)?[cC]ite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)$/;
const REF_RE = /\\(?:auto|c|C|eq|page|name|v|V)?ref\*?\{([^}]*)$/;

let bibCache: { key: string; entries: BibEntry[]; at: number } | null = null;

async function loadBib(projectId: string, branch: string): Promise<BibEntry[]> {
  const cacheKey = `${projectId}::${branch}`;
  if (bibCache && bibCache.key === cacheKey && Date.now() - bibCache.at < 15_000) return bibCache.entries;
  try {
    const entries = await api.bib(projectId, branch);
    bibCache = { key: cacheKey, entries, at: Date.now() };
    return entries;
  } catch {
    return bibCache?.entries || [];
  }
}

export function invalidateBibCache(): void {
  bibCache = null;
}

function firstAuthor(author?: string): string {
  if (!author) return '';
  const first = author.split(/\s+and\s+/i)[0];
  const lastName = first.includes(',') ? first.split(',')[0] : first.split(' ').pop() || first;
  return author.match(/\band\b/i) ? `${lastName} et al.` : lastName;
}

function asSource(source: (ctx: CompletionContext) => CompletionResult | null | Promise<CompletionResult | null>): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}

export function citeCompletionSource(projectId: string, branch: string): Extension {
  return asSource(async (ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const m = before.match(CITE_RE);
    if (!m) return null;
    const segment = m[1];
    const lastComma = segment.lastIndexOf(',');
    const q = segment.slice(lastComma + 1).trim().toLowerCase();
    const from = ctx.pos - (segment.length - lastComma - 1);
    const entries = await loadBib(projectId, branch);
    const options: Completion[] = entries
      .filter((e) =>
        !q ||
        e.key.toLowerCase().includes(q) ||
        (e.author || '').toLowerCase().includes(q) ||
        (e.title || '').toLowerCase().includes(q) ||
        (e.year || '').includes(q))
      .slice(0, 80)
      .map((e) => ({
        label: e.key,
        detail: [firstAuthor(e.author), e.year].filter(Boolean).join(' '),
        info: e.title,
        type: 'constant',
        boost: e.key.toLowerCase().startsWith(q) ? 2 : 0,
      }));
    if (!options.length) return null;
    return { from, options, validFor: /^[^,}]*$/ };
  });
}

export function refCompletionSource(): Extension {
  return asSource((ctx) => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const m = before.match(REF_RE);
    if (!m) return null;
    const q = m[1].toLowerCase();
    const labels = new Set<string>();
    const text = ctx.state.doc.toString();
    const re = /\\label\{([^}]+)\}/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(text))) labels.add(mm[1]);
    const options = Array.from(labels)
      .filter((l) => !q || l.toLowerCase().includes(q))
      .map((l) => ({ label: l, type: 'variable' as const }));
    if (!options.length) return null;
    return { from: ctx.pos - m[1].length, options, validFor: /^[^}]*$/ };
  });
}

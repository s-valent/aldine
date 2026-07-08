import Anthropic from '@anthropic-ai/sdk';

/**
 * AI error-fix helper. Bring-your-own Anthropic API key (server-side only —
 * the key never reaches the browser). Model + endpoint are env-configurable so
 * it can point at a self-hosted/compatible gateway or a test mock.
 */
const MODEL = process.env.PAPYR_AI_MODEL || 'claude-opus-4-8';

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface AiFix { file: string; find: string; replace: string; note?: string }
export interface AiResult { explanation: string; fixes: AiFix[] }

interface DiagnoseInput {
  rootFile: string;
  files: Array<{ path: string; content: string }>;
  errors: Array<{ type: string; line: number | null; message: string; file?: string }>;
  log: string;
}

function numberLines(src: string): string {
  return src.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n');
}

/** Robustly pull a JSON object out of a model response (handles ```json fences). */
function extractJson(text: string): AiResult {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  else {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) s = s.slice(first, last + 1);
  }
  const parsed = JSON.parse(s) as Partial<AiResult>;
  return {
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : 'No explanation returned.',
    fixes: Array.isArray(parsed.fixes)
      ? parsed.fixes.filter((f) => f && typeof f.find === 'string' && typeof f.replace === 'string').map((f) => ({
          file: String(f.file || ''),
          find: String(f.find),
          replace: String(f.replace),
          note: f.note ? String(f.note) : undefined,
        }))
      : [],
  };
}

const SYSTEM = `You are a LaTeX expert helping a writer fix compilation errors in their document.
You are given the compiler error list, the tail of the compile log, and the project's .tex source files (with line numbers).
Diagnose the most likely cause and propose the smallest set of concrete edits that will make the document compile.

Respond with ONLY a JSON object, no preamble and no markdown fences:
{
  "explanation": "1-3 sentences in plain English: what went wrong and how the fix addresses it.",
  "fixes": [
    { "file": "main.tex", "find": "<exact substring currently in the file>", "replace": "<the corrected text>", "note": "short label" }
  ]
}
Rules: "find" MUST be an exact, unique substring of the current file content so it can be replaced verbatim (do not include the line-number prefixes shown in the source). Keep each fix minimal. If a needed package is missing, add the \\usepackage line via a fix that targets an existing preamble line. If you cannot determine a safe automatic fix, return an empty "fixes" array and explain what the user should check.`;

export async function diagnose(input: DiagnoseInput): Promise<AiResult> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL from env
  const sources = input.files
    .map((f) => `--- ${f.path} ---\n${numberLines(f.content)}`)
    .join('\n\n')
    .slice(0, 40_000);
  const errs = input.errors
    .filter((e) => e.type === 'error')
    .slice(0, 20)
    .map((e) => `${e.file || input.rootFile}:${e.line ?? '?'} — ${e.message}`)
    .join('\n');

  const user = `Root file: ${input.rootFile}\n\nErrors:\n${errs || '(none parsed; see log)'}\n\nCompile log (tail):\n${input.log.slice(-3000)}\n\nSource files:\n${sources}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return extractJson(text);
}

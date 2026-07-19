/** Minimal BibTeX parser — enough for autocomplete metadata (key, type, author, title, year). */

export interface BibEntry {
  key: string;
  type: string;
  author?: string;
  title?: string;
  year?: string;
  journal?: string;
  file: string;
}

/** Just the citation keys (skipping @comment/@string/@preamble) — a cheap
 *  dedup check without parseBib's per-entry field extraction. */
export function bibKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const re = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    keys.add(m[2]);
  }
  return keys;
}

export function parseBib(source: string, file: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const re = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    const key = m[2];
    // capture the balanced body of the entry
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(re.lastIndex, i - 1);
    const field = (name: string): string | undefined => {
      const fm = body.match(new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(\\{|")`, 'i'));
      if (!fm) return undefined;
      const open = fm[1];
      let start = fm.index! + fm[0].length;
      if (open === '{') {
        let d = 1; let j = start;
        while (j < body.length && d > 0) {
          if (body[j] === '{') d++;
          else if (body[j] === '}') d--;
          j++;
        }
        return clean(body.slice(start, j - 1));
      } else {
        const end = body.indexOf('"', start);
        return end === -1 ? undefined : clean(body.slice(start, end));
      }
    };
    entries.push({
      key,
      type,
      file,
      author: field('author'),
      title: field('title'),
      year: field('year') || (field('date') || '').slice(0, 4) || undefined,
      journal: field('journal') || field('journaltitle') || field('booktitle'),
    });
  }
  return entries;
}

function clean(s: string): string {
  return s.replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\s*/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a DOI, doi.org URL, or arXiv id to a BibTeX entry using free public
 * endpoints — no account, complements the Zotero integration.
 */

const ARXIV_RE = /(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5})(v\d+)?/i;
const DOI_RE = /10\.\d{4,9}\/[^\s"']+/;

const DOI_BASE = process.env.DOI_API_BASE || 'https://doi.org';
const ARXIV_BASE = process.env.ARXIV_API_BASE || 'https://export.arxiv.org';

export async function fetchBibEntry(query: string): Promise<string | null> {
  // A real DOI (starts with 10.) wins even if it mentions arXiv (e.g. 10.48550/arXiv.1706.03762).
  const doiMatch = query.match(DOI_RE);
  if (doiMatch) return fetchDoi(doiMatch[0]);

  // otherwise treat an explicit arXiv reference or a bare arXiv id
  const arxiv = query.match(ARXIV_RE);
  if (arxiv) return fetchArxiv(arxiv[1]);
  return null;
}

/** Read a response body but abort if it exceeds a sane cap (defends against huge redirect targets). */
async function readCapped(res: Response, cap = 2 * 1024 * 1024): Promise<string> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > cap) throw new Error('reference response too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > cap) throw new Error('reference response too large');
  return buf.toString('utf8');
}

async function fetchDoi(doi: string): Promise<string | null> {
  const res = await fetch(`${DOI_BASE}/${encodeURIComponent(doi)}`, {
    headers: { Accept: 'application/x-bibtex; charset=utf-8' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`DOI lookup failed (HTTP ${res.status})`);
  const bib = (await readCapped(res)).trim();
  return bib.startsWith('@') ? bib : null;
}

async function fetchArxiv(id: string): Promise<string | null> {
  const res = await fetch(`${ARXIV_BASE}/api/query?id_list=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`arXiv lookup failed (HTTP ${res.status})`);
  const feed = await readCapped(res);
  // parse within the <entry> element only — the feed also has its own <title>
  const xml = (feed.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1];
  if (!xml) return null;
  const pick = (tag: string) => (xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]?.trim();
  const title = pick('title')?.replace(/\s+/g, ' ');
  if (!title) return null;
  const published = pick('published') || '';
  const year = published.slice(0, 4);
  const authors = Array.from(xml.matchAll(/<name>([^<]+)<\/name>/g)).map((m) => m[1].trim());
  const authorField = authors.map((a) => {
    const parts = a.split(' ');
    const last = parts.pop();
    return `${last}, ${parts.join(' ')}`;
  }).join(' and ');
  const first = authors[0]?.split(' ').pop()?.toLowerCase().replace(/[^a-z]/g, '') || 'anon';
  const key = `${first}${year}`;
  return `@article{${key},
  title        = {${title}},
  author       = {${authorField}},
  year         = {${year}},
  eprint       = {${id}},
  archivePrefix = {arXiv},
  url          = {https://arxiv.org/abs/${id}},
}`;
}

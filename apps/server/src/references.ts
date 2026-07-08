/**
 * Resolve a DOI, doi.org URL, or arXiv id to a BibTeX entry using free public
 * endpoints — no account, complements the Zotero integration.
 */

const ARXIV_RE = /(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5})(v\d+)?/i;
const DOI_RE = /10\.\d{4,9}\/[^\s"']+/;

const DOI_BASE = process.env.DOI_API_BASE || 'https://doi.org';
const ARXIV_BASE = process.env.ARXIV_API_BASE || 'https://export.arxiv.org';
const OPENALEX_BASE = process.env.OPENALEX_API_BASE || 'https://api.openalex.org';

export interface SearchHit { id: string; doi: string | null; title: string; authors: string; year: number | null; venue: string }

/** Full-text search across OpenAlex (250M+ works, no key). */
export async function searchWorks(query: string, limit = 12): Promise<SearchHit[]> {
  const url = `${OPENALEX_BASE}/works?search=${encodeURIComponent(query)}&per_page=${limit}&mailto=papyr@localhost`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const data = JSON.parse(await readCapped(res, 4 * 1024 * 1024)) as { results?: Array<Record<string, unknown>> };
  return (data.results || []).map((w) => {
    const authorships = (w.authorships as Array<{ author?: { display_name?: string } }> | undefined) || [];
    const authors = authorships.slice(0, 4).map((a) => a.author?.display_name).filter(Boolean).join(', ') + (authorships.length > 4 ? ', et al.' : '');
    const loc = (w.primary_location as { source?: { display_name?: string } } | undefined)?.source?.display_name;
    return {
      id: String(w.id || '').split('/').pop() || '',
      doi: w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//, '') : null,
      title: String(w.title || w.display_name || 'Untitled'),
      authors,
      year: (w.publication_year as number) ?? null,
      venue: loc || '',
    };
  });
}

/** BibTeX for an OpenAlex work id (Wxxxx): prefer its DOI, else synthesize from metadata. */
async function fetchOpenAlex(id: string): Promise<string | null> {
  const res = await fetch(`${OPENALEX_BASE}/works/${encodeURIComponent(id)}?mailto=papyr@localhost`);
  if (!res.ok) throw new Error(`OpenAlex lookup failed (HTTP ${res.status})`);
  const w = JSON.parse(await readCapped(res)) as Record<string, unknown>;
  const doi = w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//, '') : null;
  if (doi) { try { const b = await fetchDoi(doi); if (b) return b; } catch { /* fall through to synthesis */ } }
  const authorships = (w.authorships as Array<{ author?: { display_name?: string } }> | undefined) || [];
  const authorField = authorships.map((a) => {
    const n = a.author?.display_name || '';
    const parts = n.split(' ');
    const last = parts.pop();
    return last ? `${last}, ${parts.join(' ')}` : n;
  }).join(' and ');
  const year = (w.publication_year as number) ?? '';
  const title = String(w.title || w.display_name || 'Untitled');
  const first = authorships[0]?.author?.display_name?.split(' ').pop()?.toLowerCase().replace(/[^a-z]/g, '') || 'anon';
  const venue = (w.primary_location as { source?: { display_name?: string } } | undefined)?.source?.display_name || '';
  return `@article{${first}${year},
  title   = {${title}},
  author  = {${authorField}},
  year    = {${year}},${venue ? `\n  journaltitle = {${venue}},` : ''}
  url     = {${w.id}},
}`;
}

export async function fetchBibEntry(query: string): Promise<string | null> {
  // OpenAlex work id (openalex:W… or a full openalex.org/W… URL)
  const oa = query.match(/(?:openalex[:/]|openalex\.org\/)?(W\d{2,})/i);
  if (/openalex/i.test(query) && oa) return fetchOpenAlex(oa[1]);

  // A real DOI (starts with 10.) wins even if it mentions arXiv (e.g. 10.48550/arXiv.1706.03762).
  const doiMatch = query.match(DOI_RE);
  if (doiMatch) return fetchDoi(doiMatch[0]);

  // an explicit arXiv reference or a bare arXiv id
  const arxiv = query.match(ARXIV_RE);
  if (arxiv) return fetchArxiv(arxiv[1]);

  // a bare OpenAlex id
  if (oa) return fetchOpenAlex(oa[1]);
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

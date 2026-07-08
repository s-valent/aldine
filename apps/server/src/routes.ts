import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import * as gitops from './gitops.js';
import * as zotero from './zotero.js';
import { compileProject, synctexLookup } from './compile.js';
import { flushBranchDocs, refreshBranchDocsFromDisk, evictDoc } from './collab.js';
import { parseBib, BibEntry } from './bib.js';
import { listPlugins, pluginAssetPath } from './plugins.js';
import { listTemplates, templateFiles } from './templates.js';
import { fetchBibEntry, searchWorks } from './references.js';
import { unzip, guessRoot } from './unzip.js';
import { aiConfigured, aiModel, diagnose } from './ai.js';
import * as comments from './comments.js';
import * as auth from './auth.js';
import { canAccess, isOwner, ownerName } from './authz.js';
import { loginLimiter, aiLimiter, refLimiter, compileGate, clientKey } from './ratelimit.js';
import { safeJoin, isTextFile } from './util.js';

type Q = { branch?: string; path?: string; name?: string; force?: string };

/** current user for a request (null when auth disabled or not signed in) */
function reqUser(req: { headers: { cookie?: string } }): auth.PublicUser | null {
  return auth.userFromRequest(req.headers.cookie);
}

/** git internals and compile output are never user-addressable. */
function isHiddenPath(rel: string): boolean {
  const first = rel.split('/')[0];
  return first === '.git' || first.startsWith('.papyr');
}

function publicMeta(meta: store.ProjectMeta, user?: auth.PublicUser | null) {
  const { zotero: z, ownerId, ...rest } = meta;
  return {
    ...rest,
    ownerId,
    ownerName: ownerName(meta),
    isOwner: user !== undefined ? isOwner(meta, user) : undefined,
    zotero: z ? {
      libraryPrefix: z.libraryPrefix,
      collectionKey: z.collectionKey,
      bibFile: z.bibFile,
      lastSyncedAt: z.lastSyncedAt,
      username: z.username,
    } : null,
  };
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, name: 'papyr' }));

  // ---------- auth (env-gated) ----------
  app.get('/api/auth/me', async (req) => ({ authEnabled: auth.AUTH_ENABLED, user: reqUser(req) }));

  app.post<{ Body: { email: string; password: string; name?: string } }>('/api/auth/register', async (req, reply) => {
    if (!auth.AUTH_ENABLED) return reply.code(400).send({ error: 'Auth is not enabled' });
    try {
      const user = auth.register(req.body.email, req.body.password, req.body.name);
      reply.header('set-cookie', auth.sessionCookie(auth.mintToken(user.id)));
      return { user };
    } catch (err: any) { return reply.code(400).send({ error: err.message }); }
  });

  app.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (req, reply) => {
    if (!auth.AUTH_ENABLED) return reply.code(400).send({ error: 'Auth is not enabled' });
    if (!loginLimiter.take(clientKey(req))) return reply.code(429).send({ error: 'Too many attempts — wait a moment and try again' });
    try {
      const user = auth.login(req.body.email, req.body.password);
      reply.header('set-cookie', auth.sessionCookie(auth.mintToken(user.id)));
      return { user };
    } catch (err: any) { return reply.code(401).send({ error: err.message }); }
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', auth.clearCookie());
    return { ok: true };
  });

  // Global guard: enforce project access when auth is on. Runs after routing,
  // so it uses the DECODED :id param — never a regex over the raw (still
  // percent-encoded) URL, which a `%61bc…` id would slip past.
  app.addHook('preHandler', async (req, reply) => {
    if (!auth.AUTH_ENABLED) return;
    const id = (req.params as { id?: string } | undefined)?.id;
    if (id !== undefined) {
      let meta: store.ProjectMeta;
      try { meta = store.readMeta(id); } catch { return reply.code(404).send({ error: 'project not found' }); }
      const user = reqUser(req);
      if (!user) return reply.code(401).send({ error: 'Sign in required' });
      if (!canAccess(meta, user)) return reply.code(403).send({ error: 'You do not have access to this project' });
      return;
    }
    // non-id routes: require sign-in for the project list / create / import
    const path = req.url.split('?')[0];
    if (/^\/api\/projects(\/import)?$/.test(path) && !reqUser(req)) {
      return reply.code(401).send({ error: 'Sign in required' });
    }
  });

  // ---------- projects ----------
  app.get('/api/projects', async (req) => {
    const user = reqUser(req);
    return store.listProjects().filter((m) => canAccess(m, user)).map((m) => publicMeta(m, user));
  });

  app.post<{ Body: { name?: string; files?: Record<string, string>; template?: string } }>('/api/projects', async (req, reply) => {
    const { name = 'Untitled Project', files, template } = req.body || {};
    let seed = files;
    if (template) {
      try {
        seed = templateFiles(template);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    }
    const meta = await store.createProject(name, seed, reqUser(req)?.id);
    return publicMeta(meta, reqUser(req));
  });

  // ---------- sharing (owner only) ----------
  app.post<{ Params: { id: string }; Body: { mode?: 'private' | 'link'; collaborators?: string[] } }>(
    '/api/projects/:id/share', async (req, reply) => {
      const meta = store.readMeta(req.params.id);
      if (!isOwner(meta, reqUser(req))) return reply.code(403).send({ error: 'Only the owner can change sharing' });
      const mode = req.body?.mode === 'link' ? 'link' : 'private';
      const collaborators = Array.isArray(req.body?.collaborators)
        ? req.body!.collaborators.map((c) => c.trim().toLowerCase()).filter((c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)).slice(0, 50)
        : (meta.share?.collaborators || []);
      meta.share = { mode, collaborators };
      store.writeMeta(meta);
      return publicMeta(meta, reqUser(req));
    });

  app.get('/api/templates', async () => listTemplates());

  // Import an Overleaf/project ZIP (base64) as a new project.
  app.post<{ Body: { name?: string; zipBase64: string } }>('/api/projects/import', async (req, reply) => {
    const { name, zipBase64 } = req.body || {};
    if (!zipBase64) return reply.code(400).send({ error: 'zipBase64 required' });
    try {
      const buf = Buffer.from(zipBase64, 'base64');
      if (buf.length > 60 * 1024 * 1024) return reply.code(413).send({ error: 'ZIP too large (max 60 MB)' });
      const entries = unzip(buf);
      const paths = Object.keys(entries).filter((p) => !p.includes('..') && !p.startsWith('/') && !p.startsWith('__MACOSX/') && !isHiddenPath(p));
      if (!paths.length) return reply.code(400).send({ error: 'ZIP had no usable files' });
      // create with text files seeded; write binaries as buffers afterward
      const textFiles: Record<string, string> = {};
      const binFiles: string[] = [];
      for (const p of paths) {
        const data = entries[p];
        // treat as text only if the extension says so AND there's no NUL byte in the head
        const looksBinary = data.subarray(0, 8000).includes(0);
        if (isTextFile(p) && !looksBinary) textFiles[p] = data.toString('utf8');
        else binFiles.push(p);
      }
      const meta = await store.createProject(name || 'Imported project', textFiles, reqUser(req)?.id);
      for (const p of binFiles) store.writeFile(meta.id, 'main', p, entries[p]);
      if (binFiles.length) await gitops.commitAll(meta.id, 'main', 'papyr: import assets').catch(() => {});
      const root = guessRoot(entries);
      if (root) { meta.rootFile = root; store.writeMeta(meta); }
      return publicMeta(meta);
    } catch (err: any) {
      return reply.code(400).send({ error: `Could not import ZIP: ${err.message}` });
    }
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    try {
      const meta = store.readMeta(req.params.id);
      const branches = await gitops.listBranches(meta.id);
      return { ...publicMeta(meta, reqUser(req)), branches };
    } catch {
      return reply.code(404).send({ error: 'project not found' });
    }
  });

  app.patch<{ Params: { id: string }; Body: Partial<Pick<store.ProjectMeta, 'name' | 'rootFile' | 'engine'>> }>(
    '/api/projects/:id', async (req) => {
      const meta = store.readMeta(req.params.id);
      const { name, rootFile, engine } = req.body || {};
      if (name) meta.name = name;
      if (rootFile) meta.rootFile = rootFile;
      if (engine) meta.engine = engine;
      store.writeMeta(meta);
      return publicMeta(meta);
    });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const meta = store.readMeta(req.params.id);
    if (!isOwner(meta, reqUser(req))) return reply.code(403).send({ error: 'Only the owner can delete this project' });
    store.deleteProject(req.params.id);
    return { ok: true };
  });

  // ---------- files ----------
  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/files', async (req) => {
    const branch = req.query.branch || 'main';
    await gitops.ensureWorktree(req.params.id, branch);
    return store.listFiles(req.params.id, branch);
  });

  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/file', async (req, reply) => {
    const { branch = 'main', path: rel } = req.query;
    if (!rel) return reply.code(400).send({ error: 'path required' });
    if (isHiddenPath(rel)) return reply.code(403).send({ error: 'forbidden path' });
    try {
      const buf = store.readFile(req.params.id, branch, rel);
      const ext = path.extname(rel).toLowerCase();
      const mime = ext === '.pdf' ? 'application/pdf'
        : ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)
          ? `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`
          : 'text/plain; charset=utf-8';
      return reply.type(mime).send(buf);
    } catch {
      return reply.code(404).send({ error: 'file not found' });
    }
  });

  app.put<{ Params: { id: string }; Body: { branch?: string; path: string; content?: string; encoding?: 'utf8' | 'base64' } }>(
    '/api/projects/:id/file', async (req, reply) => {
      const { branch = 'main', path: rel, content = '', encoding = 'utf8' } = req.body || {};
      if (!rel) return reply.code(400).send({ error: 'path required' });
      if (isHiddenPath(rel)) return reply.code(403).send({ error: 'forbidden path' });
      await gitops.ensureWorktree(req.params.id, branch);
      store.writeFile(req.params.id, branch, rel, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
      refreshBranchDocsFromDisk(req.params.id, branch);
      return { ok: true };
    });

  app.post<{ Params: { id: string }; Body: { branch?: string; from: string; to: string } }>(
    '/api/projects/:id/file/rename', async (req, reply) => {
      const { branch = 'main', from, to } = req.body || {};
      if (!from || !to) return reply.code(400).send({ error: 'from/to required' });
      if (isHiddenPath(from) || isHiddenPath(to)) return reply.code(403).send({ error: 'forbidden path' });
      // evict the source doc first so its final store can't recreate the old file
      evictDoc(req.params.id, branch, from);
      store.renameFile(req.params.id, branch, from, to);
      return { ok: true };
    });

  app.delete<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/file', async (req, reply) => {
    const { branch = 'main', path: rel } = req.query;
    if (!rel) return reply.code(400).send({ error: 'path required' });
    if (isHiddenPath(rel)) return reply.code(403).send({ error: 'forbidden path' });
    evictDoc(req.params.id, branch, rel); // prevent resurrection via pending store
    store.deleteFile(req.params.id, branch, rel);
    return { ok: true };
  });

  /** Serve compile artifacts (PDF, synctex) from the branch's .papyr-out. */
  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/output', async (req, reply) => {
    const { branch = 'main', path: rel } = req.query;
    if (!rel || !rel.startsWith('.papyr-out/')) return reply.code(400).send({ error: 'bad output path' });
    try {
      const abs = safeJoin(store.branchDir(req.params.id, branch), rel);
      const buf = fs.readFileSync(abs);
      const type = rel.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
      return reply.type(type).header('cache-control', 'no-store').send(buf);
    } catch {
      return reply.code(404).send({ error: 'artifact not found' });
    }
  });

  // ---------- compile ----------
  app.post<{ Params: { id: string }; Body: { branch?: string } }>('/api/projects/:id/compile', async (req, reply) => {
    const branch = req.body?.branch || 'main';
    const key = clientKey(req, reqUser(req)?.id);
    if (!compileGate.tryAcquire(key)) {
      return reply.code(429).send({ ok: false, pdf: null, pdfUrl: null, log: '', errors: [], durationMs: 0, error: 'Too many typesets in flight — let the current ones finish' });
    }
    try {
      return await compileProject(req.params.id, branch);
    } catch (err: any) {
      return reply.code(400).send({ ok: false, pdf: null, pdfUrl: null, log: '', errors: [], durationMs: 0, error: err.message });
    } finally {
      compileGate.release(key);
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> & { branch?: string } }>(
    '/api/projects/:id/synctex', async (req) => {
      const { branch = 'main', ...payload } = req.body || {};
      return synctexLookup(req.params.id, branch, payload);
    });

  // ---------- bib index (for \cite autocomplete) ----------
  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/bib', async (req) => {
    const branch = req.query.branch || 'main';
    flushBranchDocs(req.params.id, branch);
    const entries: BibEntry[] = [];
    for (const f of store.listFiles(req.params.id, branch)) {
      if (f.type === 'file' && f.path.endsWith('.bib')) {
        try {
          entries.push(...parseBib(store.readFile(req.params.id, branch, f.path).toString('utf8'), f.path));
        } catch { /* skip broken bib */ }
      }
    }
    return entries;
  });

  // ---------- label index (for \ref autocomplete across files) ----------
  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/labels', async (req) => {
    const branch = req.query.branch || 'main';
    flushBranchDocs(req.params.id, branch);
    const labels: Array<{ label: string; file: string }> = [];
    const re = /\\label\{([^}]+)\}/g;
    for (const f of store.listFiles(req.params.id, branch)) {
      if (f.type !== 'file' || !f.path.endsWith('.tex')) continue;
      try {
        const text = store.readFile(req.params.id, branch, f.path).toString('utf8');
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) labels.push({ label: m[1], file: f.path });
      } catch { /* skip */ }
    }
    return labels;
  });

  // ---------- git ----------
  app.get<{ Params: { id: string } }>('/api/projects/:id/branches', async (req) => gitops.listBranches(req.params.id));

  app.post<{ Params: { id: string }; Body: { name: string; from?: string } }>(
    '/api/projects/:id/branches', async (req, reply) => {
      const { name, from = 'main' } = req.body || {};
      if (!name) return reply.code(400).send({ error: 'name required' });
      // capture latest edits so the new branch starts from what the user sees
      flushBranchDocs(req.params.id, from);
      await gitops.commitAll(req.params.id, from, 'papyr: checkpoint before branching').catch(() => {});
      await gitops.createBranch(req.params.id, name, from);
      return { ok: true };
    });

  app.delete<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/branches', async (req, reply) => {
    const { name } = req.query;
    if (!name) return reply.code(400).send({ error: 'name required' });
    await gitops.deleteBranch(req.params.id, name);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { branch?: string; message?: string; author?: string } }>(
    '/api/projects/:id/commit', async (req) => {
      const { branch = 'main', message = 'papyr: manual commit', author } = req.body || {};
      flushBranchDocs(req.params.id, branch);
      return gitops.commitAll(req.params.id, branch, message, author);
    });

  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/log', async (req) => {
    return gitops.log(req.params.id, req.query.branch || 'main');
  });

  app.get<{ Params: { id: string; hash: string } }>('/api/projects/:id/commit/:hash/diff', async (req, reply) => {
    try { return await gitops.commitDiff(req.params.id, req.params.hash); }
    catch (err: any) { return reply.code(400).send({ error: err.message }); }
  });

  app.post<{ Params: { id: string }; Body: { from: string; into: string; author?: string } }>(
    '/api/projects/:id/merge', async (req, reply) => {
      const { from, into, author } = req.body || {};
      if (!from || !into) return reply.code(400).send({ error: 'from/into required' });
      flushBranchDocs(req.params.id, from);
      flushBranchDocs(req.params.id, into);
      const result = await gitops.merge(req.params.id, from, into, author);
      if (result.ok) refreshBranchDocsFromDisk(req.params.id, into);
      return result;
    });

  // ---------- zotero ----------
  app.post<{ Body: { apiKey: string } }>('/api/zotero/validate', async (req, reply) => {
    const { apiKey } = req.body || {};
    if (!apiKey) return reply.code(400).send({ error: 'apiKey required' });
    try {
      const info = await zotero.validateKey(apiKey);
      const groups = await zotero.listGroups(apiKey, info.userID);
      return { ...info, groups };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post<{ Body: { apiKey: string; libraryPrefix: string } }>('/api/zotero/collections', async (req, reply) => {
    const { apiKey, libraryPrefix } = req.body || {};
    if (!apiKey || !libraryPrefix) return reply.code(400).send({ error: 'apiKey and libraryPrefix required' });
    try {
      return await zotero.listCollections(apiKey, libraryPrefix);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post<{ Params: { id: string }; Body: { apiKey: string; libraryPrefix: string; collectionKey?: string; bibFile?: string } }>(
    '/api/projects/:id/zotero/link', async (req, reply) => {
      const { apiKey, libraryPrefix, collectionKey, bibFile = 'zotero.bib' } = req.body || {};
      if (!apiKey || !libraryPrefix) return reply.code(400).send({ error: 'apiKey and libraryPrefix required' });
      try {
        const info = await zotero.validateKey(apiKey);
        const meta = store.readMeta(req.params.id);
        meta.zotero = { apiKey, userId: info.userID, username: info.username, libraryPrefix, collectionKey, bibFile };
        store.writeMeta(meta);
        const sync = await zotero.syncProject(req.params.id, 'main', true);
        return { ok: true, ...sync };
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    });

  app.post<{ Params: { id: string }; Body: { branch?: string; force?: boolean } }>(
    '/api/projects/:id/zotero/sync', async (req, reply) => {
      try {
        return await zotero.syncProject(req.params.id, req.body?.branch || 'main', !!req.body?.force);
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    });

  app.delete<{ Params: { id: string } }>('/api/projects/:id/zotero', async (req) => {
    const meta = store.readMeta(req.params.id);
    delete meta.zotero;
    store.writeMeta(meta);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/api/projects/:id/zotero/search', async (req, reply) => {
    const meta = store.readMeta(req.params.id);
    if (!meta.zotero) return reply.code(400).send({ error: 'no Zotero link' });
    try {
      return await zotero.searchItems(meta.zotero.apiKey, meta.zotero.libraryPrefix, req.query.q || '');
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ---------- reference lookup (DOI / arXiv → BibTeX) ----------
  app.post<{ Params: { id: string }; Body: { query: string; branch?: string; bibFile?: string } }>(
    '/api/projects/:id/references/add', async (req, reply) => {
      const { query, branch = 'main', bibFile = 'references.bib' } = req.body || {};
      if (!query) return reply.code(400).send({ error: 'query required' });
      if (!refLimiter.take(clientKey(req, reqUser(req)?.id))) return reply.code(429).send({ error: 'Rate limit reached — please slow down' });
      try {
        const entry = await fetchBibEntry(query.trim());
        if (!entry) return reply.code(404).send({ error: 'No reference found for that DOI/arXiv id' });
        // append to the .bib (create if missing), skipping duplicate keys
        await gitops.ensureWorktree(req.params.id, branch);
        let existing = '';
        try { existing = store.readFile(req.params.id, branch, bibFile).toString('utf8'); } catch { /* new file */ }
        const key = (entry.match(/@\w+\s*\{\s*([^,\s]+)/) || [])[1];
        if (key && new RegExp(`@\\w+\\s*\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`).test(existing)) {
          return { ok: true, key, duplicate: true };
        }
        store.writeFile(req.params.id, branch, bibFile, existing.trimEnd() + '\n\n' + entry.trim() + '\n');
        refreshBranchDocsFromDisk(req.params.id, branch);
        return { ok: true, key, bibFile };
      } catch (err: any) {
        return reply.code(502).send({ error: err.message });
      }
    });

  // ---------- reference search (OpenAlex) ----------
  app.get<{ Querystring: { q?: string } }>('/api/references/search', async (req, reply) => {
    const q = (req.query.q || '').trim();
    if (q.length < 3) return [];
    if (!refLimiter.take(clientKey(req, reqUser(req)?.id))) return reply.code(429).send({ error: 'Search rate limit reached — please slow down' });
    try {
      return await searchWorks(q);
    } catch (err: any) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ---------- review comments ----------
  app.get<{ Params: { id: string }; Querystring: Q }>('/api/projects/:id/comments', async (req) =>
    comments.listComments(req.params.id, req.query.branch || 'main'));

  app.post<{ Params: { id: string }; Body: { branch?: string; file: string; anchor: { from: number; to: number; quote: string }; body: string; suggestion?: string; author?: string } }>(
    '/api/projects/:id/comments', async (req, reply) => {
      const b = req.body || ({} as any);
      if (!b.file || !b.anchor) return reply.code(400).send({ error: 'file and anchor required' });
      return comments.addComment(req.params.id, {
        branch: b.branch || 'main',
        file: b.file,
        anchor: b.anchor,
        author: reqUser(req)?.name || b.author || 'Anonymous',
        body: b.body || '',
        suggestion: b.suggestion,
      });
    });

  app.post<{ Params: { id: string; cid: string }; Body: { body: string; author?: string } }>(
    '/api/projects/:id/comments/:cid/reply', async (req, reply) => {
      const c = comments.replyComment(req.params.id, req.params.cid, reqUser(req)?.name || req.body?.author || 'Anonymous', req.body?.body || '');
      return c || reply.code(404).send({ error: 'comment not found' });
    });

  app.post<{ Params: { id: string; cid: string }; Body: { resolved?: boolean } }>(
    '/api/projects/:id/comments/:cid/resolve', async (req, reply) => {
      const c = comments.resolveComment(req.params.id, req.params.cid, req.body?.resolved !== false);
      return c || reply.code(404).send({ error: 'comment not found' });
    });

  app.delete<{ Params: { id: string; cid: string } }>('/api/projects/:id/comments/:cid', async (req) => {
    comments.deleteComment(req.params.id, req.params.cid);
    return { ok: true };
  });

  // ---------- AI error fix ----------
  app.get('/api/ai/status', async () => ({ configured: aiConfigured(), model: aiModel() }));

  app.post<{ Params: { id: string }; Body: { branch?: string; errors?: Array<{ type: string; line: number | null; message: string; file?: string }>; log?: string } }>(
    '/api/projects/:id/ai/fix', async (req, reply) => {
      if (!aiConfigured()) return reply.code(400).send({ error: 'AI is not configured. Set an ANTHROPIC_API_KEY or OPENROUTER_API_KEY on the server to enable it.' });
      if (!aiLimiter.take(clientKey(req, reqUser(req)?.id))) return reply.code(429).send({ error: 'AI rate limit reached — please slow down' });
      const { branch = 'main', errors = [], log = '' } = req.body || {};
      const meta = store.readMeta(req.params.id);
      flushBranchDocs(req.params.id, branch);
      const files: Array<{ path: string; content: string }> = [];
      for (const f of store.listFiles(req.params.id, branch)) {
        if (f.type === 'file' && f.path.endsWith('.tex')) {
          try { files.push({ path: f.path, content: store.readFile(req.params.id, branch, f.path).toString('utf8') }); } catch { /* skip */ }
        }
      }
      try {
        const result = await diagnose({ rootFile: meta.rootFile, files, errors, log });
        return { ok: true, ...result };
      } catch (err: any) {
        return reply.code(502).send({ error: `AI request failed: ${err.message}` });
      }
    });

  // ---------- plugins ----------
  app.get('/api/plugins', async () => listPlugins());

  app.get<{ Params: { pluginId: string; '*': string } }>('/plugins/:pluginId/*', async (req, reply) => {
    const abs = pluginAssetPath(req.params.pluginId, req.params['*']);
    if (!abs) return reply.code(404).send({ error: 'not found' });
    const ext = path.extname(abs);
    const type = ext === '.js' || ext === '.mjs' ? 'text/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.json' ? 'application/json'
      : 'application/octet-stream';
    return reply.type(type).send(fs.readFileSync(abs));
  });
}

# Papyr

**Write LaTeX together. Fast, versioned, yours.**

Papyr is a slim, self-hosted, open-source LaTeX collaboration platform — an
Overleaf alternative built for speed and simplicity. Two containers, no Mongo,
no Redis, no 13-microservice sprawl.

![Papyr editor](e2e/shots/editor-light.png)

## Features

- **Real-time collaboration** — CRDT-based (Yjs), multi-cursor with live presence,
  conflict-free by construction. Unlimited collaborators.
- **Fast LaTeX compilation** — TeX Live + latexmk with persistent incremental
  builds (~2s warm recompiles), sandboxed (`-no-shell-escape`, timeouts),
  errors surfaced with line numbers and click-to-jump.
- **Git-native with branches** — every project is a real git repository.
  Create branches, edit them independently, merge back — from the UI.
  Auto-checkpoints while you write, named checkpoints when you want them.
- **Native Zotero integration** — link your Zotero library *or a single
  collection* (Overleaf can't), keep a `.bib` in sync with cheap
  version-aware refresh, insert citations from a search panel or via
  `\cite{` autocomplete.
- **Review mode** — select text and leave an anchored, threaded comment;
  optionally attach a suggested replacement the author accepts with one click.
  Comments highlight in the editor, resolve/reopen, and track edits.
- **AI error fix** (optional, BYO key) — on a failed typeset, get a
  plain-English diagnosis and one-click fixes. Set `ANTHROPIC_API_KEY` on the
  server to enable; the key stays server-side and never reaches the browser.
- **Cite by DOI / arXiv** — paste an identifier, get BibTeX appended and the
  `\cite` inserted (no account, free public APIs).
- **SyncTeX both ways** — double-click the PDF to jump to source; ⌘J to jump
  the PDF to your cursor, with a highlight flash.
- **Plugin system** — manifest + ES module plugins extend the sidebar,
  editor, and commands. Zotero and DOI-cite ship as plugins; write your own.
- **Templates** — article, IAC conference paper, beamer, report/thesis.
- **Editor niceties** — auto-typeset on idle, live word count, PDF zoom,
  drag-drop figure upload, plain-English error hints + raw log.
- **Multi-user auth** (optional) — set `AUTH_ENABLED=1` for email/password
  login, per-project ownership, and sharing (invite-only or link). Off by
  default (single-tenant). Passwords are scrypt-hashed; sessions are signed
  HTTP-only cookies; the collab socket is access-checked.
- **Apple-style UI** — system fonts, hairline borders, light & dark mode,
  keyboard-first (⌘S typeset, ⌘J jump, ⌘K command palette).

## Quick start

```bash
docker compose up -d --build
open http://localhost:8080
```

That's it. Projects live in the `papyr-data` volume.

## Development

```bash
npm install
npm run dev:server     # API + collab on :3000
npm run dev:web        # Vite on :5173 (proxies to :3000)
docker build -t papyr-compiler apps/compiler
docker run -d -p 4020:4020 -v $PWD/.data:/data papyr-compiler
```

### Tests

End-to-end (Playwright — covers compile, collab, branches, plugins, Zotero):

```bash
npx playwright install chromium
npm run test:e2e                          # self-starting stack on :3100
PAPYR_URL=http://localhost:8080 npm run test:e2e   # against docker compose
```

## Production deploy

```bash
# 1. HTTPS via Caddy (auto-provisions certificates for your domain)
PAPYR_DOMAIN=papyr.example.com docker compose --profile tls up -d

# 2. Turn on the optional features you want (all env-gated, off by default)
AUTH_ENABLED=1 \
OPENROUTER_API_KEY=sk-or-... \
GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=... PAPYR_PUBLIC_URL=https://papyr.example.com \
SENTRY_DSN=https://... \
docker compose --profile tls up -d

# 3. Back up (data + secrets volumes) / restore
deploy/backup.sh papyr-backup.tar.gz
deploy/restore.sh papyr-backup.tar.gz   # stop the stack first: docker compose down
```

**Isolation & limits.** The compiler runs on an internal-only Docker network (no
internet egress), drops all Linux capabilities, and is bounded on CPU / memory /
PIDs; LaTeX compiles with `-no-shell-escape` and `openin_any=p`. Per-client rate
limits guard login, AI, and reference lookups; compiles are concurrency-capped.

## Architecture

```
┌────────────┐   HTTP/WS    ┌──────────────────────────────┐
│  Browser   │ ───────────► │  app (Node 22)               │
│  React +   │              │  Fastify API + Hocuspocus    │
│  CM6 + Yjs │              │  git repos + worktrees       │
└────────────┘              └──────────┬───────────────────┘
                                       │ shared volume /data
                            ┌──────────▼───────────────────┐
                            │  compiler (TeX Live medium)  │
                            │  latexmk wrapper, sandboxed  │
                            └──────────────────────────────┘
```

- One Yjs document per file per branch (`project::branch::path`), persisted
  straight to the git worktree with debounced writes and auto-commits.
- Branches are git worktrees, so every branch is editable concurrently.
- Compile output stays inside the project tree (`.papyr-out/`, gitignored)
  which keeps latexmk's incremental cache warm.

### Data & storage

Two separate concerns, behind two seams:

- **Project files** — real git repos + worktrees on disk (`store.ts`). This is
  what gives you branches and history.
- **Relational/metadata** — users, sessions, project metadata, review comments,
  and usage — go through the `DataStore` interface (`db/`). Two backends:
  - **JSON files** (default, zero-dependency) — the slim single-node self-host.
  - **Postgres** (set `DATABASE_URL`) — the horizontally-scalable backend, for
    running multiple app nodes. `pg` is an optional dependency; the same test
    suite passes on both.

For how this scales past one box (and what the remaining walls are), see
[docs/SCALING.md](docs/SCALING.md).

## Plugins

A plugin is a folder in `plugins/`:

```
plugins/hello/
├── manifest.json   # { "id": "hello", "name": "Hello", "version": "1.0.0", "entry": "index.js" }
└── index.js        # export default { activate(papyr) { ... } }
```

The `papyr` API exposes `ui.registerSidebarPanel`, `editor.insertAtCursor`,
`project` context, `compile()`, `toast()`, and `fetch()`. See
`plugins/zotero` for a complete example.

## License

MIT

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

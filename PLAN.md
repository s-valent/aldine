# Papyr — Slim Open-Source LaTeX Collaboration Platform

A modern, fast, Apple-style Overleaf alternative. Docker-hosted, git-native, plugin-extensible.

## Acceptance Criteria (from goal)
1. ✅-target: LaTeX compilation (PDF output, logs, errors surfaced nicely)
2. ✅-target: Real-time LaTeX collaboration (multi-cursor, presence)
3. ✅-target: Git sync with multiple-branch support
4. ✅-target: Modular skill/plugin system (extensible later with Bibby-class features)
5. ✅-target: Native Zotero integration
6. ✅-target: Hostable via Docker (docker compose up)
7. ✅-target: Playwright UI tests proving all of the above
8. Paramount: Apple-style UI/UX — simple, straightforward, responsive

## Stretch
- LaTeX templates gallery
- Bibby feature parity items (per research)
- SyncTeX code↔PDF jump, spellcheck, AI-ish helpers

## Architecture (v1 hypothesis — refine after research lands)

```
docker-compose.yml
├── app        Node 22 (Fastify): REST API + Hocuspocus (Yjs) websocket + static frontend
│              - project store: git repos on volume /data/projects/<id> (real git, branches)
│              - Yjs persistence + debounced flush to worktree + auto/manual commits
│              - Zotero Web API sync -> references.bib
│              - plugin registry (manifest.json + ESM entry, served to frontend)
├── compiler   TeX Live + latexmk behind tiny HTTP API (POST files -> PDF/log/synctex)
│              - nonstopmode, no-shell-escape, timeout, per-project cache dir for speed
└── (volumes)  papyr-data (projects, yjs), papyr-cache (latex aux)
```

Frontend: React 18 + Vite + CodeMirror 6 + y-codemirror.next + pdf.js.
Design: system font stack (SF), translucent toolbars, hairline borders, subtle shadows,
light/dark, no clutter. Cmd+S = compile. Instant interactions.

## Loop protocol (autonomous)
Hypothesis → Plan → Implement → Test (Playwright) → QA/review via subagents → iterate.
Product-management subagents propose UX improvements each major cycle.

## Test assets
Example paper: /Users/rahloff/projects/paper-gsaas-2026/paper (iac.cls, biblatex, references.bib)
— must compile in Papyr.

## Status log — v0.2 COMPLETE (all acceptance criteria met + verified on Docker)
- [x] Research (Bibby features, tech stack, Zotero) — 3 agents
- [x] Scaffold monorepo (app / compiler / web)
- [x] Compile service — IAC example paper → PDF, incremental, sandboxed
- [x] Editor + real-time collab (Yjs/CM6, presence, PDF.js)
- [x] Git multi-branch (worktrees: create/switch/merge/history)
- [x] Plugin system (2 plugins: zotero, references)
- [x] Native Zotero (link/collection/sync/cite/autocomplete)
- [x] Playwright suite — 22 tests green (dev + docker)
- [x] Apple-style UX — 2 design-review rounds applied
- [x] Security fixes C1/C2/H1/H2/H4/M2 (key exfil, restart flush, etc.)

### Stretch shipped
- [x] Templates gallery (article/IAC/beamer/report)
- [x] DOI/arXiv → BibTeX cite
- [x] SyncTeX code↔PDF jump (double-click + ⌘J)
- [x] Auto-typeset on idle, word count, PDF zoom, drag-drop upload
- [x] Plain-English error hints + raw log viewer
- [x] Command palette (⌘K), spellcheck toggle, Overleaf ZIP import
- [x] Project-wide \ref indexing

### Remaining ideas (future)
- AI error auto-fix (Bibby parity — needs LLM/BYO key)
- Track changes / review mode
- Better BibTeX local companion (CAYW)
- Hunspell WASM spellcheck (upgrade from native)

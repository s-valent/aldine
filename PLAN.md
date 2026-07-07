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

## Status log
- [x] Research agents launched (Bibby features, tech stack, Zotero)
- [ ] Scaffold monorepo
- [ ] Compile service works on example paper
- [ ] Editor + collab
- [ ] Git branches
- [ ] Plugins
- [ ] Zotero
- [ ] Playwright suite green

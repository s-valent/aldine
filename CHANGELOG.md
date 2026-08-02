# Changelog

All notable changes to Aldine are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/) (pre-1.0: minor bumps may break things).

## [Unreleased]

### Added
- **Share from the editor** — the toolbar gains a Share button (owner-only,
  multi-user mode) opening the same dialog as the home-screen card. The dialog
  now shows the share URL with a Copy link button when link mode is on.

### Changed
- The repo-root `docker-compose.yml` is now the minimal prebuilt-image setup
  (identical to the README quick start). The previous full configuration —
  build-from-source, every option documented, TLS/Postgres/Redis profiles,
  hardening — moved to `docker-compose.full.yml`. Both share the same project
  name and volumes, so switching between them keeps your data.
- A share link now grants the document, not the project. Opening one lets you
  read and edit; renaming the project, syncing it to the owner's GitHub repo,
  and searching or unlinking their Zotero library are for the owner and
  invited collaborators.

### Fixed
- Link-shared projects no longer appear in every signed-in user's project
  list. "Anyone with the link" now means exactly that: the project opens via
  its URL but is listed only for the owner and invited collaborators.
- The collaborator list is no longer disclosed to everyone who can open a
  project — only the owner sees the email addresses they invited.
- Revoking access now ends live editing sessions. Previously the check ran
  only when a collaboration socket connected, so someone already in the
  document kept editing (and their edits kept being committed) after being
  removed.
- Buttons the server refuses are no longer offered: Delete on projects shared
  with you, and Publish/sync to GitHub when you are not the owner. A failed
  delete or rename now reports the error instead of silently doing nothing.
- Invalid collaborator addresses are rejected in the dialog instead of being
  silently dropped after a "Sharing updated" confirmation; semicolon- and
  newline-separated lists are accepted.
- Typing in a dialog is no longer interrupted when the editor re-renders
  underneath it (an auto-typeset tick or a collaborator's cursor moving would
  pull focus back to the first control).

## [0.2.0] — 2026-07-23

### Added
- **Visual editing mode (experimental)** — LaTeX renders as formatted text
  while the source stays the single source of truth. **Byte-stable by
  construction**: rendering never rewrites source you didn't deliberately edit
  (proven by an e2e test) — unlike Overleaf's visual editor. Includes:
  - Styled headings, bold/italic/underline, real itemize/enumerate lists.
  - **KaTeX math with click-to-edit** in a MathLive WYSIWYG popover; edits
    write back precise source.
  - **Editable tables** — `tabular` renders as a grid you edit in place
    (cell edit, add row/column).
  - **Inline tracked changes** — review suggestions show as strikethrough +
    proposed text with accept/dismiss.
  - **Paste rich text → LaTeX** — HTML from Word/Docs/web converts on paste.
  - Figure chips render the image; cite chips show author-year from the `.bib`;
    a Contents dropdown lists and jumps to headings.
  - Cursor-reveal shows raw source for the construct under any caret — including
    a remote collaborator's, so it stays collab-correct.
  Enable via "experimental Visual editor" in the command palette (⌘K), then the
  Source|Visual toggle. Off by default. Mod-B/Mod-I work in both modes.
- `ALDINE_TEXLIVE_SCHEME=full` build option: compiler image with **all of
  CTAN** preinstalled (scheme-full, ~9 GB on disk) instead of the curated medium set.
  Missing-package compile errors now name the package and point at the option.
- **Publish to GitHub** — locally-created projects can now be pushed to a
  fresh GitHub repo (`POST /api/projects/:id/github/link`; private by
  default), after which the regular sync (auto-push, pull, PRs) takes over.
  Previously only imported repos could sync. The editor shows a Publish
  button for unlinked projects and a one-time hint that unpublished work
  lives on a single server.
- **Trash instead of hard delete** — deleting a project moves it to a trash
  restorable for 30 days (`ALDINE_TRASH_DAYS`); a Trash view on the home
  page offers Restore and Delete forever. A boot + daily sweep purges
  expired entries. `DELETE …?permanent=1` bypasses the trash.
- Sample **nginx config** (`deploy/nginx.conf`) and a bring-your-own-proxy
  deployment path (nginx/Traefik first, bundled Caddy optional); the AWS
  deployment now enables **daily EFS backups** (AWS Backup, 35-day retention).

### Changed
- Relicensed from MIT to AGPL-3.0 (pre-launch, sole-author): self-hosting is
  unaffected; hosted derivatives must share their modifications. Plugins are
  separate works and may use any license.

### Fixed
- Documents no longer duplicate when a collaborator reconnects after a server
  restart/deploy (Yjs docs now reload from a binary snapshot, preserving
  operation identity, instead of reseeding from text).
- Creating or renaming a file onto an existing name no longer destroys it.
- DOI/arXiv citation import escapes `&` and other specials so the imported
  `.bib` always compiles.
- A stale biblatex `.aux` no longer breaks later compiles after the package set
  changes (the compiler cleans aux and rebuilds).
- Review-comment anchors track their text after edits above them, across reload.
- Deleting the typeset root re-points it at another `.tex`.
- Modals are proper dialogs (focus trap, Escape); editor is usable on small
  screens; assorted validation, error-state, and a11y fixes.

## [0.1.0] — 2026-07-19

First public release. Everything below is new.

### Editor & compile
- CodeMirror 6 LaTeX editor with auto-typeset on idle, live word count,
  command palette (⌘K), light/dark themes.
- TeX Live + latexmk compile service with persistent incremental builds
  (~2 s warm recompiles), sandboxed: no network egress, dropped capabilities,
  CPU/memory/PID limits, restricted shell-escape, compile timeouts.
- Error panel with plain-English hints, line numbers, click-to-jump, raw log.
- SyncTeX both ways: double-click the PDF to jump to source, ⌘J to jump the
  PDF to the cursor.
- Drag-drop figure upload, PDF zoom.

### Collaboration & versioning
- Real-time collaboration via Yjs CRDTs (embedded Hocuspocus): multi-cursor,
  live presence, conflict-free merges, unlimited collaborators.
- Every project is a real git repository; branches are git worktrees and are
  editable concurrently. Auto-checkpoints while writing, named checkpoints,
  history view with diffs, one-click revert.
- Review mode: anchored threaded comments on text selections, optional
  suggested replacements the author accepts with one click.

### Integrations
- GitHub sync: import a repo as a project, push/pull with ahead/behind
  indicators, conflict resolution, opt-in auto-sync, branch switching, open a
  PR from the editor. OAuth or personal access token.
- Zotero: link a library or a single collection, version-aware `.bib` refresh,
  citation search panel, `\cite{` autocomplete.
- Cite by DOI / arXiv identifier — BibTeX appended, `\cite` inserted.
- AI error fix (optional, BYO key via OpenRouter or Anthropic): plain-English
  diagnosis of failed typesets with one-click fixes. Key stays server-side.
- Plugin system: manifest + ES-module plugins extend sidebar, editor, and
  commands. Zotero, references, and AI-fix ship as plugins.

### Self-hosting & operations
- Two-container `docker compose up` deploy; flat-file storage by default,
  zero external services required.
- Optional multi-user auth (`AUTH_ENABLED=1`): per-project ownership and
  sharing, Google & GitHub SSO, email/password (scrypt, revocable HTTP-only
  cookie sessions), SSO-only mode, password reset via SES/SMTP.
- Scale-out path: Postgres (`DATABASE_URL`) + Redis (`REDIS_URL`) for
  multi-node; see docs/SCALING.md.
- TLS profile (Caddy auto-certificates), backup/restore scripts + systemd
  timer, Terraform for a full serverless-ish AWS deployment (deploy/aws).
- Templates: article, IAC conference paper, beamer, report/thesis.

[Unreleased]: https://github.com/trahloff/Aldine/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/trahloff/Aldine/releases/tag/v0.1.0

# Aldine — user story inventory

The behavioral contract of the application, organized by epic. Each story
lists its acceptance criteria (AC) and where it is automated (`e2e/tests/*`,
`apps/server/test/*`, or *manual* for flows only covered by hand/QA passes).
This file is the reference for QA campaigns and for scoping regressions.

Personas: **Solo** (single-tenant self-hoster), **Author** (writing, possibly
non-technical), **Collaborator** (co-author, may live in git/VS Code),
**Reviewer** (comments, suggests, doesn't typeset), **Operator** (hosts an
instance for a group).

---

## 1. First run & projects

- **US-101** — As a Solo user, opening a fresh instance shows onboarding once
  and never again after dismissal.
  AC: onboarding visible on first visit; dismissed state survives reload.
  Covered: `01-home.spec.ts`.
- **US-102** — As an Author, I create a project from a template and land in a
  working editor.
  AC: all four templates create; root `.tex` opens; project appears on Home.
  Covered: `01-home.spec.ts` (article), *manual* (other templates).
- **US-103** — As an Author, I can rename a project inline and delete a
  project with confirmation.
  AC: rename persists; delete removes card and data.
  Covered: `01-home.spec.ts` (delete), *manual* (rename).
- **US-104** — As an Author, I can import an Overleaf ZIP as a new project.
  AC: files land, root file detected, project compiles if the ZIP did.
  Covered: *manual*.
- **US-105** — As a Collaborator, I can import a GitHub repo as a project
  (OAuth or PAT).
  AC: clone succeeds, default branch mapped to `main`, files visible.
  Covered: `apps/server/test/github-sync.integration.mjs` (API level).

## 2. Files & tree

- **US-201** — As an Author, I manage files: create, rename, delete,
  including in subdirectories.
  AC: tree updates live; open editors follow renames; subdir paths compile
  (`\input{chapters/…}`).
  Covered: `12-subdir-tree.spec.ts`, *manual* (rename edge cases).
- **US-202** — As an Author, I upload files (figures) by picker or drag-drop,
  including binary.
  AC: binary upload intact; image usable via `\includegraphics`.
  Covered: `07-features.spec.ts` (upload), *manual* (drag-drop).
- **US-203** — As a Solo user, internal files (`.papyr-out`/`.aldine-out`,
  `.git`) never appear in the tree and can't be fetched via the file API.
  AC: hidden paths 403; tree excludes them.
  Covered: *manual* / API probing.

## 3. Editing & compiling

- **US-301** — As an Author, I typeset with ⌘S or the button and see the PDF
  within seconds; warm recompiles are fast.
  AC: first compile OK on templates; unchanged-doc recompile ≈1s; status
  shows timing.
  Covered: `02-compile.spec.ts`.
- **US-302** — As an Author, compile errors show plain-English hints with
  line numbers, and clicking jumps to the offending line.
  AC: hint text present; editor focused at line; missing-package hint names
  the package.
  Covered: `02-compile.spec.ts`, hints *manual*.
- **US-303** — As an Author, auto-typeset compiles ~2s after I stop typing,
  and can be toggled off.
  AC: no compile storms while typing; toggle persists.
  Covered: *manual*.
- **US-304** — As an Author, SyncTeX works both ways (double-click PDF →
  source; ⌘J → PDF position).
  AC: correct line targeted in both directions, including subdir files.
  Covered: `07-features.spec.ts`.
- **US-305** — As an Author, I get live word count (and selection count),
  spellcheck toggle, PDF zoom, and a ⌘K command palette.
  AC: counts plausible for LaTeX; palette commands all execute.
  Covered: `08-stretch.spec.ts` (partial), *manual*.
- **US-306** — As an Operator, concurrent compiles queue instead of stacking
  (per-node concurrency gate), and per-user quotas return HTTP 402 when
  exhausted.
  AC: burst of compiles serializes; over-quota surfaces a clear message.
  Covered: *manual* / API.

## 4. Real-time collaboration

- **US-401** — As Collaborators, we edit the same file live with visible
  cursors, names, and presence chips.
  AC: keystrokes propagate <2s; presence deduplicates by client.
  Covered: `03-collab.spec.ts`.
- **US-402** — As a Collaborator, my edits survive server restarts and my
  offline edits merge on reconnect without loss.
  AC: no divergence after reconnect; debounced persistence flushes on
  shutdown.
  Covered: `e2e/c2-shutdown.mjs` (harness), *manual*.
- **US-403** — As Collaborators, working on different branches of
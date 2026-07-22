# Aldine — User Story Inventory

The behaviors Aldine promises, written as user stories with acceptance
criteria. This is the QA contract: every story should be demonstrably true in
a running instance. Stories are grouped by domain; IDs are stable
(`DOMAIN-n`) so test reports can cite them.

Legend: **[auth]** needs `AUTH_ENABLED=1`; **[flag]** behind an experimental
flag; everything else works in the default single-tenant deploy.

---

## Onboarding & projects (PROJ)

- **PROJ-1** — As a new visitor, I land on the home screen and see a first-run
  onboarding overlay that I can dismiss, and it stays dismissed on return.
- **PROJ-2** — I create a project from a template (article, IAC paper, beamer,
  report) and land in the editor with the template's files seeded.
- **PROJ-3** — I create a blank project and get a minimal `main.tex` +
  `references.bib`.
- **PROJ-4** — I rename a project inline from the toolbar; the name persists.
- **PROJ-5** — I delete a project from the home screen; it disappears and its
  data is gone.
- **PROJ-6** — I import an existing project from an Overleaf/generic ZIP; its
  files and folder structure arrive intact.
- **PROJ-7** — My project list shows all my projects with names and opens the
  right one on click.

## Editing & files (EDIT)

- **EDIT-1** — I edit `.tex` source in a CodeMirror editor with LaTeX syntax
  highlighting; changes persist without an explicit save.
- **EDIT-2** — I create, rename, and delete files and folders from the file
  tree; the tree reflects each change.
- **EDIT-3** — I open a subdirectory file (`chapters/intro.tex`) and the tree
  shows nested structure correctly.
- **EDIT-4** — I upload a figure by drag-drop or the upload button; it lands in
  the project and can be `\includegraphics`'d.
- **EDIT-5** — Live word count updates as I type and reflects a selection.
- **EDIT-6** — The command palette (⌘K) opens, filters commands, and runs the
  chosen one.
- **EDIT-7** — `\cite{` and `\ref{` autocomplete from the project's
  bibliography and labels.
- **EDIT-8** — Hovering a `\cite` key shows a reference preview tooltip.
- **EDIT-9** — Spellcheck can be toggled and underlines prose in `.tex`/`.md`.

## Compile & preview (COMP)

- **COMP-1** — I press ⌘S (or Typeset) and get a rendered PDF in the preview
  pane within a few seconds.
- **COMP-2** — Auto-typeset recompiles a couple of seconds after edits settle,
  and can be turned off.
- **COMP-3** — A compile error surfaces in the Problems panel with a line
  number and a plain-English hint; clicking it jumps to the source line.
- **COMP-4** — I can view the raw compile log.
- **COMP-5** — I zoom the PDF and the setting holds.
- **COMP-6** — SyncTeX: double-clicking the PDF jumps the editor to the source
  line; ⌘J jumps the PDF to my cursor with a flash.
- **COMP-7** — A missing-package error names the package and points at
  `ALDINE_TEXLIVE_SCHEME=full`.

## Collaboration (COLLAB)

- **COLLAB-1** — Two people editing the same file see each other's changes live,
  conflict-free (CRDT), with multiple cursors.
- **COLLAB-2** — Each collaborator shows a presence indicator with name/color.
- **COLLAB-3** — Concurrent edits at different positions both survive (no lost
  updates).
- **COLLAB-4** — A collaborator joining mid-session receives the current
  document state.

## Versioning & branches (GIT)

- **GIT-1** — Every project is a git repo; auto-checkpoints happen while I write.
- **GIT-2** — I create a named checkpoint (commit) from the UI.
- **GIT-3** — I view history with diffs and can inspect a past commit.
- **GIT-4** — I create a branch, edit it independently, and switch between
  branches from the UI.
- **GIT-5** — I merge one branch into another; conflicts are reported, not
  silently lost.
- **GIT-6** — I delete a branch.

## GitHub sync (GH)

- **GH-1** — I import a GitHub repo as a project (OAuth or PAT).
- **GH-2** — I push commits to GitHub with a message; ahead/behind indicators
  update.
- **GH-3** — I pull remote changes; conflicts are surfaced.
- **GH-4** — I open a pull request from the editor.
- **GH-5** — I switch the synced remote branch.
- **GH-6** — Opt-in auto-sync pushes on a schedule; manual push always pushes.
- **GH-7** — Auth tokens never land in the compiler-visible project dir.

## References & Zotero (REF)

- **REF-1** — I cite by DOI or arXiv id; BibTeX is appended and `\cite`
  inserted, no account needed.
- **REF-2** — I link a Zotero library or a single collection and validate the
  connection.
- **REF-3** — My `.bib` refreshes from Zotero with version-aware sync.
- **REF-4** — I search my Zotero library and insert a citation from a panel.

## Review mode (REV)

- **REV-1** — I select text and leave an anchored, threaded comment.
- **REV-2** — I attach a suggested replacement; the author accepts it with one
  click and the text changes.
- **REV-3** — Comments highlight in the editor; I resolve and reopen them.
- **REV-4** — Comments sync live between collaborators.

## AI error fix (AI)

- **AI-1** — With a key configured, a failed compile offers a plain-English
  diagnosis and one-click fixes; without a key the feature is absent.
- **AI-2** — The API key stays server-side and never reaches the browser.

## Plugins (PLUG)

- **PLUG-1** — Built-in plugins (Zotero, references, AI-fix) load and register
  sidebar panels / commands.
- **PLUG-2** — A plugin can insert text at the cursor, compile, toast, and
  fetch.

## Auth & sharing (AUTH) [auth]

- **AUTH-1** — With auth on, I register, log in, log out, and my session
  persists; my projects are mine.
- **AUTH-2** — Google & GitHub SSO sign-in works; SSO-only mode hides
  passwords.
- **AUTH-3** — I request a password reset and receive a link (email transport)
  scoped to the configured public URL.
- **AUTH-4** — Registering a password for an email that has SSO is blocked
  (anti-hijack).
- **AUTH-5** — Project sharing (invite-only or link) grants the right access;
  the collab socket is access-checked.
- **AUTH-6** — Per-user compile quota returns HTTP 402 past the limit.

## Visual editor (VIS) [flag]

- **VIS-1** — I enable the experimental visual editor and toggle Source|Visual;
  the switch is instant with no flicker or lost cursor.
- **VIS-2** — Headings, bold/italic/underline, and lists render as formatted
  text; markup hides.
- **VIS-3** — The construct under my caret (and a remote caret) reveals its raw
  source; leaving re-renders.
- **VIS-4** — Math renders via KaTeX; clicking opens a MathLive editor that
  writes back precise source.
- **VIS-5** — Tables render as an editable grid (cell edit, add row/column);
  figures show the image; cites show author-year.
- **VIS-6** — A review suggestion renders as an inline tracked change I can
  accept or dismiss.
- **VIS-7** — Pasting rich HTML converts to clean LaTeX.
- **VIS-8** — The Contents dropdown lists headings and jumps to them.
- **VIS-9** — **The invariant**: nothing I do in visual mode rewrites source I
  didn't deliberately edit (byte-stable).

## Cross-cutting (X)

- **X-1** — Light/dark theme: dark is the default; the toggle flips instantly
  and the choice persists.
- **X-2** — The UI is responsive and has no horizontal overflow at common
  widths.
- **X-3** — Keyboard access: visible focus, palette-first operation, no traps.
- **X-4** — Errors and empty states are informative, not dead ends.
- **X-5** — Rate limits guard login, AI, and reference lookups without locking
  out normal use.
- **X-6** — The compiler is sandboxed (no egress, dropped caps, restricted
  shell-escape).

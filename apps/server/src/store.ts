import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, SimpleGit } from 'simple-git';
import { projectsDir, worktreesDir, metaDir } from './config.js';
import { newId, safeJoin, BRANCH_RE, PROJECT_ID_RE, isTextFile } from './util.js';

export interface ProjectMeta {
  id: string;
  name: string;
  rootFile: string;
  engine: 'pdf' | 'xelatex' | 'lualatex';
  createdAt: string;
  /** secrets & integration state live here, outside the git repo */
  zotero?: {
    apiKey: string;
    userId: number;
    username?: string;
    libraryPrefix: string; // e.g. users/123 or groups/456
    collectionKey?: string;
    lastVersion?: number;
    bibFile: string; // e.g. zotero.bib
    lastSyncedAt?: string;
  };
}

export function repoDir(id: string): string {
  if (!PROJECT_ID_RE.test(id)) throw new Error('bad project id');
  return path.join(projectsDir, id);
}

/** Directory containing the checkout of a given branch. main lives in the repo dir; others get worktrees. */
export function branchDir(id: string, branch: string): string {
  if (!BRANCH_RE.test(branch) || branch.includes('..')) throw new Error('bad branch name');
  if (branch === 'main') return repoDir(id);
  // Flatten hierarchical names (feature/x) to a single dir segment so a branch
  // named "feature" can't collide with "feature/x"'s worktree parent.
  const safe = branch.replace(/[^A-Za-z0-9._-]/g, '__');
  return path.join(worktreesDir, id, safe);
}

export function git(dir: string): SimpleGit {
  return simpleGit({ baseDir: dir });
}

function metaPath(id: string): string {
  return path.join(metaDir, `${id}.json`);
}

export function readMeta(id: string): ProjectMeta {
  return JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
}

export function writeMeta(meta: ProjectMeta): void {
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

export function listProjects(): ProjectMeta[] {
  if (!fs.existsSync(metaDir)) return [];
  return fs.readdirSync(metaDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(metaDir, f), 'utf8')) as ProjectMeta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createProject(name: string, files: Record<string, string> = {}): Promise<ProjectMeta> {
  const id = newId();
  const dir = repoDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const g = git(dir);
  await g.init(['--initial-branch=main']);
  await g.addConfig('user.name', 'Papyr');
  await g.addConfig('user.email', 'papyr@localhost');

  const seed = Object.keys(files).length ? files : {
    'main.tex': DEFAULT_MAIN_TEX(name),
    'references.bib': DEFAULT_BIB,
  };
  for (const [rel, content] of Object.entries(seed)) {
    const abs = safeJoin(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.aux\n*.log\n*.out\n*.toc\n*.bbl\n*.bcf\n*.blg\n*.synctex.gz\n*.fls\n*.fdb_latexmk\n*.run.xml\n');
  await g.add(['-A']);
  await g.commit('Initial commit');

  const rootFile = fs.existsSync(path.join(dir, 'main.tex')) ? 'main.tex'
    : Object.keys(seed).find((f) => f.endsWith('.tex')) || 'main.tex';
  const meta: ProjectMeta = { id, name, rootFile, engine: 'pdf', createdAt: new Date().toISOString() };
  writeMeta(meta);
  return meta;
}

export function deleteProject(id: string): void {
  fs.rmSync(repoDir(id), { recursive: true, force: true });
  fs.rmSync(path.join(worktreesDir, id), { recursive: true, force: true });
  fs.rmSync(metaPath(id), { force: true });
}

export interface TreeEntry { path: string; type: 'file' | 'dir'; size?: number; binary?: boolean }

export function listFiles(id: string, branch: string): TreeEntry[] {
  const base = branchDir(id, branch);
  const out: TreeEntry[] = [];
  const walk = (rel: string) => {
    const abs = path.join(base, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === '.git' || e.name.startsWith('.papyr')) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ path: relPath, type: 'dir' });
        walk(relPath);
      } else {
        out.push({ path: relPath, type: 'file', size: fs.statSync(path.join(base, relPath)).size, binary: !isTextFile(relPath) });
      }
    }
  };
  walk('');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFile(id: string, branch: string, rel: string): Buffer {
  return fs.readFileSync(safeJoin(branchDir(id, branch), rel));
}

export function writeFile(id: string, branch: string, rel: string, content: string | Buffer): void {
  const abs = safeJoin(branchDir(id, branch), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function deleteFile(id: string, branch: string, rel: string): void {
  fs.rmSync(safeJoin(branchDir(id, branch), rel), { recursive: true, force: true });
}

export function renameFile(id: string, branch: string, from: string, to: string): void {
  const base = branchDir(id, branch);
  const absTo = safeJoin(base, to);
  fs.mkdirSync(path.dirname(absTo), { recursive: true });
  fs.renameSync(safeJoin(base, from), absTo);
}

const DEFAULT_MAIN_TEX = (title: string) => `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage[backend=biber]{biblatex}
\\addbibresource{references.bib}

\\title{${title.replace(/[\\{}]/g, '')}}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Start writing here\\ldots

\\printbibliography
\\end{document}
`;

const DEFAULT_BIB = `@article{knuth1984,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111},
}
`;

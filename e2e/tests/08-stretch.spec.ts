import { test, expect } from '@playwright/test';
import { createProject, createPaperProject, openProject, cleanup, PAPER_DIR } from './helpers';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

test.describe('command palette', () => {
  test('Cmd+K opens palette and can open a file', async ({ page, request }) => {
    const id = await createProject(request, 'Palette Test');
    try {
      await openProject(page, id);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await expect(page.getByTestId('command-palette')).toBeVisible();
      await page.getByTestId('palette-input').fill('references.bib');
      await expect(page.getByTestId('palette-item-open-references.bib')).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('command-palette')).not.toBeVisible();
      // the bib file is now the active file
      await expect(page.locator('.tree__item--active')).toContainText('references.bib');
    } finally {
      await cleanup(request, id);
    }
  });

  test('palette can insert an equation snippet', async ({ page, request }) => {
    const id = await createProject(request, 'Palette Snippet');
    try {
      await openProject(page, id);
      await page.locator('.cm-content').click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.getByTestId('palette-input').fill('equation');
      await page.getByTestId('palette-item-snippet-eq').click();
      await expect(page.locator('.cm-content')).toContainText('\\begin{equation}');
    } finally {
      await cleanup(request, id);
    }
  });
});

test.describe('ZIP import', () => {
  test('import a project ZIP from the home page', async ({ page, request }) => {
    // build a small zip fixture
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papyr-zip-'));
    fs.writeFileSync(path.join(tmp, 'main.tex'), '\\documentclass{article}\\begin{document}ZIP-IMPORTED\\end{document}');
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'hello');
    const zip = path.join(tmp, 'proj.zip');
    execSync(`cd ${tmp} && zip -q -r ${zip} main.tex notes.txt`);

    await page.goto('/');
    await page.getByTestId('import-input').setInputFiles(zip);
    await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('file-main.tex')).toBeVisible();
    await expect(page.getByTestId('file-notes.txt')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('ZIP-IMPORTED');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

test.describe('project-wide \\ref indexing', () => {
  test('\\ref completes labels from another file', async ({ page, request }) => {
    const id = await createProject(request, 'Ref Index');
    try {
      // add a second file with a label
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'sections.tex', content: '\\section{Method}\\label{sec:crossref}' } });
      await openProject(page, id);
      await page.locator('.cm-content').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' \\ref{sec:cro');
      await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('sec:crossref', { timeout: 10_000 });
    } finally {
      await cleanup(request, id);
    }
  });
});

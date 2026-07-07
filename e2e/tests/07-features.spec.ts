import { test, expect } from '@playwright/test';
import { createProject, openProject, cleanup } from './helpers';

test.describe('v0.2 features', () => {
  test('template gallery creates a compiling project', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('new-project').click();
    await page.getByTestId('new-project-name').fill('From Beamer');
    await expect(page.getByTestId('template-grid')).toBeVisible();
    await page.getByTestId('template-beamer').click();
    await page.getByTestId('create-project').click();
    await expect(page.getByTestId('editor-shell')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('documentclass', { timeout: 15_000 });
    await expect(page.locator('.cm-content')).toContainText('beamer');
  });

  test('word count updates live', async ({ page, request }) => {
    const id = await createProject(request, 'Word Count');
    try {
      await openProject(page, id);
      await expect(page.getByTestId('word-count')).toBeVisible();
      await page.locator('.cm-content').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' alpha beta gamma delta epsilon');
      await expect(page.getByTestId('word-count')).toContainText(/\d+ words/, { timeout: 10_000 });
    } finally {
      await cleanup(request, id);
    }
  });

  test('drag-drop / picker upload adds a binary file', async ({ page, request }) => {
    const id = await createProject(request, 'Upload Test');
    try {
      await openProject(page, id);
      // 1x1 transparent PNG
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      await page.getByTestId('upload-input').setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: png });
      await expect(page.getByTestId('file-figure.png')).toBeVisible({ timeout: 10_000 });
      // and it is retrievable
      const res = await request.get(`/api/projects/${id}/file?branch=main&path=figure.png`);
      expect(res.ok()).toBeTruthy();
    } finally {
      await cleanup(request, id);
    }
  });

  test('auto-typeset compiles after idle without pressing Typeset', async ({ page, request }) => {
    const id = await createProject(request, 'Auto Typeset');
    try {
      await openProject(page, id);
      await expect(page.getByTestId('auto-toggle')).toHaveClass(/auto-toggle--on/);
      await page.locator('.cm-content').click();
      await page.keyboard.type(' \\par More text. ');
      // no Cmd+S — auto should fire (~2s debounce)
      await expect(page.getByTestId('pdf-status')).toContainText('Typeset in', { timeout: 60_000 });
    } finally {
      await cleanup(request, id);
    }
  });

  test('error log viewer opens', async ({ page, request }) => {
    const id = await createProject(request, 'Log Viewer');
    try {
      // break it
      const res = await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`);
      const broken = (await res.text()).replace('\\section{Introduction}', '\\undefinedcmd');
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: broken } });
      await openProject(page, id);
      await page.getByTestId('typeset-button').click();
      await expect(page.getByTestId('errors-panel')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('view-log').click();
      await expect(page.getByTestId('log-view')).toContainText(/Undefined control sequence|undefinedcmd/i);
    } finally {
      await cleanup(request, id);
    }
  });
});

test.describe('DOI / arXiv citation (references plugin)', () => {
  test('add a reference by DOI and insert the cite', async ({ page, request }) => {
    const id = await createProject(request, 'DOI Cite');
    try {
      await openProject(page, id);
      const tab = page.getByTestId('tab-plugin:references');
      await expect(tab).toBeVisible({ timeout: 15_000 });
      await tab.click();
      await page.getByTestId('reference-query').fill('10.1145/mock.12345');
      await page.getByTestId('reference-add').click();
      // cite inserted into the editor
      await expect(page.locator('.cm-content')).toContainText('\\cite{doe2020}', { timeout: 15_000 });
      // entry landed in references.bib
      const bib = await request.get(`/api/projects/${id}/bib?branch=main`);
      const entries = await bib.json();
      expect(entries.some((e: { key: string }) => e.key === 'doe2020')).toBeTruthy();
    } finally {
      await cleanup(request, id);
    }
  });
});

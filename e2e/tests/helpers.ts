import { APIRequestContext, Page, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const PAPER_DIR = process.env.PAPER_DIR || '/Users/rahloff/projects/paper-gsaas-2026/paper';

export async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/projects', { data: { name } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}

/** Create a project seeded with the real IAC example paper. */
export async function createPaperProject(request: APIRequestContext, name = 'GSaaS Paper'): Promise<string> {
  const id = await createProject(request, name);
  for (const f of ['main.tex', 'references.bib', 'iac.cls', 'iac.bbx', 'iac.cbx']) {
    const content = fs.readFileSync(path.join(PAPER_DIR, f), 'utf8');
    const res = await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: f, content } });
    expect(res.ok()).toBeTruthy();
  }
  return id;
}

export async function openProject(page: Page, id: string, branch?: string): Promise<void> {
  await page.goto(`/p/${id}${branch ? `?branch=${branch}` : ''}`);
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.getByTestId('code-pane')).toBeVisible();
  // editor content mounted
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** Type into the CodeMirror editor at the end of the document. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End').catch(() => {});
  // Meta+End is not a CM default everywhere; use Ctrl/Cmd-less fallback
  await page.keyboard.press('PageDown');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

export async function typeset(page: Page): Promise<void> {
  await page.getByTestId('typeset-button').click();
}

export async function expectTypesetOk(page: Page, timeout = 120_000): Promise<void> {
  await expect(page.getByTestId('pdf-status')).toContainText('Typeset in', { timeout });
  await expect(page.locator('canvas.pdf-page').first()).toBeVisible({ timeout: 20_000 });
}

export async function cleanup(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/projects/${id}`).catch(() => {});
}

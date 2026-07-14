import { test, expect } from '@playwright/test';
import { createProject, openProject, cleanup } from './helpers';

test.describe('nested repos', () => {
  test('file tree renders directories and nested files', async ({ page, request }) => {
    const id = await createProject(request, 'Nested Tree');
    try {
      for (const [p, c] of Object.entries({
        'paper/main.tex': '\\documentclass{article}\\begin{document}x\\end{document}\n',
        'paper/chapters/intro.tex': 'Intro.\n',
        'figs/a.tex': 'fig\n',
      })) await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: p, content: c } });
      await openProject(page, id);
      await expect(page.getByTestId('dir-paper')).toBeVisible();
      await expect(page.getByTestId('dir-paper/chapters')).toBeVisible();
      await expect(page.getByTestId('file-paper/chapters/intro.tex')).toBeVisible();
      // collapse a folder → its child hides
      await page.getByTestId('dir-paper/chapters').click();
      await expect(page.getByTestId('file-paper/chapters/intro.tex')).toHaveCount(0);
    } finally { await cleanup(request, id); }
  });

  test('a root file in a subdirectory compiles (latexmk -cd)', async ({ page, request }) => {
    const id = await createProject(request, 'Subdir Root');
    try {
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'book/main.tex',
        content: '\\documentclass{article}\\begin{document}\\input{sections/one}\\end{document}\n' } });
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'book/sections/one.tex', content: 'Hello from a subdir input.\n' } });
      await request.patch(`/api/projects/${id}`, { data: { rootFile: 'book/main.tex' } });
      await openProject(page, id);
      await page.getByTestId('typeset-button').click();
      await expect(page.getByTestId('pdf-status')).toContainText('Typeset in', { timeout: 60_000 });
      await expect(page.locator('canvas.pdf-page').first()).toBeVisible({ timeout: 20_000 });
    } finally { await cleanup(request, id); }
  });
});

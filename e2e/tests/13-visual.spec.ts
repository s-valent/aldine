import { test, expect } from '../fixtures';
import { createProject, openProject, cleanup } from './helpers';

const DOC = [
  '\\section{Introduction}',
  'Hello \\textbf{brave} new \\emph{world} of text.',
  '',
  '\\subsection{Details}',
  'More prose here.',
  '',
].join('\n');

test.describe('visual editor (experimental)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('aldine.experimental.visualEditor', '1');
      window.localStorage.setItem('aldine.editorMode', 'visual');
    });
  });

  async function seed(request: Parameters<typeof createProject>[0], name: string) {
    const id = await createProject(request, name);
    await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: DOC } });
    return id;
  }

  test('renders headings and styles, toggles back to source without remount', async ({ page, request }) => {
    const id = await seed(request, 'Visual Render');
    try {
      await openProject(page, id);
      // park the caret in plain prose — the construct under the caret is
      // (correctly) revealed as source, and a fresh doc opens with caret at 0
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      // markup hidden, content rendered
      await expect(page.locator('.cm-content')).toContainText('Introduction');
      await expect(page.locator('.cm-content')).not.toContainText('\\section{');
      await expect(page.locator('.cm-vis-h1')).toHaveCount(1);
      await expect(page.locator('.cm-vis-h2')).toHaveCount(1);
      await expect(page.locator('.cm-vis-b')).toContainText('brave');
      await expect(page.locator('.cm-vis-i')).toContainText('world');

      // tag the editor DOM, toggle to Source — same DOM node must survive (no remount)
      await page.evaluate(() => { document.querySelector('.cm-content')!.setAttribute('data-mounted', 'once'); });
      await page.getByTestId('mode-toggle').getByRole('tab', { name: 'Source' }).click();
      await expect(page.locator('.cm-content')).toContainText('\\section{Introduction}');
      await expect(page.locator('.cm-content[data-mounted="once"]')).toHaveCount(1);

      // and back
      await page.getByTestId('mode-toggle').getByRole('tab', { name: 'Visual' }).click();
      await expect(page.locator('.cm-content')).not.toContainText('\\section{');
      await expect(page.locator('.cm-content[data-mounted="once"]')).toHaveCount(1);
    } finally {
      await cleanup(request, id);
    }
  });

  test('cursor-reveal shows source for the construct under the caret', async ({ page, request }) => {
    const id = await seed(request, 'Visual Reveal');
    try {
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await expect(page.locator('.cm-vis-b')).toContainText('brave');
      await page.locator('.cm-vis-b').click();
      // the bold construct un-renders: raw markup visible
      await expect(page.locator('.cm-content')).toContainText('\\textbf{brave}');
      // click into plain prose → re-renders
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await expect(page.locator('.cm-content')).not.toContainText('\\textbf{');
    } finally {
      await cleanup(request, id);
    }
  });

  test('a visual-mode cursor tour never changes a byte of source', async ({ page, request }) => {
    const id = await seed(request, 'Visual Bytes');
    try {
      await openProject(page, id);
      await page.locator('.cm-line', { hasText: 'More prose here.' }).click();
      await expect(page.locator('.cm-vis-h1')).toHaveCount(1);
      // tour: click into every construct, arrow across atomic boundaries
      for (const target of ['.cm-vis-b', '.cm-vis-i', '.cm-vis-h1', '.cm-vis-h2'] as const) {
        await page.locator(target).first().click({ force: true }).catch(() => {});
        for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
      }
      await page.keyboard.press('End');
      await page.keyboard.press('Home');
      // let the collab layer flush any (nonexistent) writes
      await page.waitForTimeout(3000);
      const res = await request.get(`/api/projects/${id}/file?branch=main&path=main.tex`);
      expect(await res.text()).toBe(DOC);
    } finally {
      await cleanup(request, id);
    }
  });

  test('spellcheck toggle no longer remounts the editor', async ({ page, request }) => {
    const id = await seed(request, 'No Remount');
    try {
      await openProject(page, id);
      await page.evaluate(() => { document.querySelector('.cm-content')!.setAttribute('data-mounted', 'once'); });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.getByTestId('palette-input').fill('spellcheck');
      await page.keyboard.press('Enter');
      await expect(page.locator('.cm-content[data-mounted="once"]')).toHaveCount(1);
    } finally {
      await cleanup(request, id);
    }
  });
});

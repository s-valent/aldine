import { test, expect } from '@playwright/test';
import { createProject, openProject, cleanup } from './helpers';

test.describe('review mode', () => {
  test('select text, add a comment with a suggestion, accept it, and see the file change', async ({ page, request }) => {
    const id = await createProject(request, 'Review');
    try {
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: 'PLACEHOLDER needs replacing.\n' } });
      await openProject(page, id);
      await expect(page.locator('.cm-content')).toContainText('PLACEHOLDER', { timeout: 10_000 });

      // double-click precisely on PLACEHOLDER (start of the line)
      const line = await page.locator('.cm-line').first().boundingBox();
      await page.mouse.dblclick(line!.x + 30, line!.y + line!.height / 2);
      await expect.poll(async () => await page.evaluate(() => window.getSelection()?.toString())).toBe('PLACEHOLDER');

      // add a comment + suggestion via the two prompts
      let promptCount = 0;
      page.on('dialog', (d) => { promptCount++; d.accept(promptCount === 1 ? 'Rename this' : 'REPLACED'); });
      await page.getByTestId('add-comment').click();

      // it lands in the Review tab
      await expect(page.getByTestId('review-panel')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('review-panel')).toContainText('Rename this');
      await expect(page.getByTestId('review-panel')).toContainText('Suggested change');

      // accept the suggestion → file text updates
      await page.locator('[data-testid^="accept-"]').first().click();
      await expect(page.locator('.cm-content')).toContainText('REPLACED needs replacing', { timeout: 10_000 });
      await expect(page.locator('.cm-content')).not.toContainText('PLACEHOLDER');
    } finally {
      await cleanup(request, id);
    }
  });

  test('comment can be resolved and reopened', async ({ page, request }) => {
    const id = await createProject(request, 'Review Resolve');
    try {
      const c = await (await request.post(`/api/projects/${id}/comments`, {
        data: { branch: 'main', file: 'main.tex', anchor: { from: 0, to: 5, quote: '\\docu' }, body: 'Check this' },
      })).json();
      await openProject(page, id);
      await page.getByTestId('tab-review').click();
      await expect(page.getByTestId(`comment-${c.id}`)).toContainText('Check this');
      await page.getByTestId(`resolve-${c.id}`).click();
      // resolved comments move under the "Resolved" divider
      await expect(page.getByTestId('review-panel')).toContainText('Resolved (1)', { timeout: 10_000 });
    } finally {
      await cleanup(request, id);
    }
  });
});

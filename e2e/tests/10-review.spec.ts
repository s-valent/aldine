import { test, expect } from '../fixtures';
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

      // add a comment + suggestion via the integrated composer (no browser dialog)
      await page.getByTestId('add-comment').click();
      await expect(page.getByTestId('comment-composer')).toBeVisible();
      await page.getByTestId('comment-body').fill('Rename this');
      await page.getByTestId('comment-suggest-toggle').click();
      await page.getByTestId('comment-suggestion').fill('REPLACED');
      await page.getByTestId('comment-submit').click();

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

test.describe('real-time review', () => {
  test('a comment added in one browser appears live in another', async ({ browser, request }) => {
    const id = await createProject(request, 'Live Review');
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: 'Shared review document here.\n' } });
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await a.goto(`/p/${id}`); await b.goto(`/p/${id}`);
      for (const p of [a, b]) {
        await expect(p.locator('.cm-content')).toContainText('Shared', { timeout: 10_000 });
      }
      await b.getByTestId('tab-review').click();
      await expect(b.getByTestId('review-panel')).toBeVisible();

      // A selects the word "Shared" and adds a comment through the composer
      const line = await a.locator('.cm-line').first().boundingBox();
      await a.mouse.dblclick(line!.x + 20, line!.y + line!.height / 2);
      await a.getByTestId('add-comment').click();
      await a.getByTestId('comment-body').fill('LIVE-COMMENT-XYZ');
      await a.getByTestId('comment-submit').click();
      await expect(a.getByTestId('review-panel')).toContainText('LIVE-COMMENT-XYZ', { timeout: 10_000 });

      // B, without reloading, receives the signal and re-fetches → sees the comment live
      await expect(b.getByTestId('review-panel')).toContainText('LIVE-COMMENT-XYZ', { timeout: 10_000 });
    } finally {
      await ctxA.close(); await ctxB.close();
      await cleanup(request, id);
    }
  });
});

test.describe('comment re-anchoring (QA regression)', () => {
  test('a comment highlight tracks its text after edits shift its offset', async ({ page, request }) => {
    const id = await createProject(request, 'Reanchor');
    try {
      // seed a file and anchor a comment on ANCHOR_ME at offset 0 via the API
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: 'ANCHOR_ME here.\nmore lines\n' } });
      const c = await request.post(`/api/projects/${id}/comments`, {
        data: { branch: 'main', file: 'main.tex', anchor: { from: 0, to: 9, quote: 'ANCHOR_ME' }, body: 'anchor test', author: 'QA' },
      });
      expect(c.ok()).toBeTruthy();
      // now shift ANCHOR_ME down by prepending text — the stored offset (0) is stale
      await request.put(`/api/projects/${id}/file`, { data: { branch: 'main', path: 'main.tex', content: 'PREPENDED LINE ONE\nPREPENDED LINE TWO\n' + 'ANCHOR_ME here.\nmore lines\n' } });
      // open fresh: the client must re-anchor the comment to ANCHOR_ME by its quote,
      // not leave the highlight on the (now different) text at offset 0
      await openProject(page, id);
      await expect(page.locator('.cm-comment-range')).toContainText('ANCHOR_ME', { timeout: 10_000 });
      await expect(page.locator('.cm-comment-range')).not.toContainText('PREPENDED');
    } finally {
      await cleanup(request, id);
    }
  });
});

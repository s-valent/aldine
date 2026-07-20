import { test, expect } from '../fixtures';

test.describe('home', () => {
  test('create a project from the home screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home__brand')).toContainText('aldine');
    await page.getByTestId('new-project').click();
    await page.getByTestId('new-project-name').fill('My First Paper');
    await page.getByTestId('create-project').click();
    await expect(page.getByTestId('editor-shell')).toBeVisible();
    await expect(page.getByTestId('project-name')).toContainText('My First Paper');
    // seeded files are present
    await expect(page.getByTestId('file-main.tex')).toBeVisible();
    await expect(page.getByTestId('file-references.bib')).toBeVisible();
    // and it shows up back home
    await page.goto('/');
    await expect(page.getByTestId('project-grid')).toContainText('My First Paper');
  });

  test('delete a project', async ({ page, request }) => {
    const res = await request.post('/api/projects', { data: { name: 'Doomed Project' } });
    const { id } = await res.json();
    await page.goto('/');
    const card = page.getByTestId(`project-card-${id}`);
    await expect(card).toBeVisible();
    page.on('dialog', (d) => d.accept());
    await card.locator('.project-card__del').click();
    await expect(card).not.toBeVisible();
  });
});

test.describe('first-run onboarding', () => {
  test('shows on first visit and stays dismissed after', async ({ browser }) => {
    const ctx = await browser.newContext(); // raw context → no pre-dismiss, fresh localStorage
    const p = await ctx.newPage();
    try {
      await p.goto('/');
      await expect(p.getByTestId('onboarding')).toBeVisible({ timeout: 10_000 });
      await p.getByTestId('onboard-dismiss').click();
      await expect(p.getByTestId('onboarding')).toHaveCount(0);
      await p.reload();
      await expect(p.getByTestId('onboarding')).toHaveCount(0);
    } finally { await ctx.close(); }
  });
});

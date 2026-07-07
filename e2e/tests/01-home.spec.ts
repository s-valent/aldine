import { test, expect } from '@playwright/test';

test.describe('home', () => {
  test('create a project from the home screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home__brand')).toContainText('papyr');
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

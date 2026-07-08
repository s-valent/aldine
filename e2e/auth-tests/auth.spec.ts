import { test, expect } from '@playwright/test';

/** Unique email per run so re-runs don't collide with the persisted user store. */
const uniq = () => `u${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`;

async function register(page: import('@playwright/test').Page, email: string, password = 'password123', name = 'Tester') {
  await page.goto('/');
  await expect(page.getByTestId('auth-email')).toBeVisible();
  await page.getByTestId('auth-switch').click(); // to register mode
  await page.getByTestId('auth-name').fill(name);
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await expect(page.locator('.home__brand')).toBeVisible({ timeout: 15_000 });
}

test.describe('auth', () => {
  test('gate blocks unauthenticated access and shows login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('auth-email')).toBeVisible();
    await expect(page.getByTestId('auth-submit')).toBeVisible();
  });

  test('register, create a project, sign out, sign back in — project persists', async ({ page }) => {
    const email = uniq();
    await register(page, email);
    // signed in — create a project
    await page.getByTestId('new-project').click();
    await page.getByTestId('new-project-name').fill('My Private Paper');
    await page.getByTestId('create-project').click();
    await expect(page.getByTestId('editor-shell')).toBeVisible();
    await expect(page.getByTestId('code-pane')).toBeVisible();

    // back home, sign out
    await page.goto('/');
    await expect(page.getByTestId('user-name')).toBeVisible();
    await page.getByTestId('logout').click();
    await expect(page.getByTestId('auth-email')).toBeVisible();

    // sign back in — project is still there
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('password123');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('project-grid')).toContainText('My Private Paper', { timeout: 15_000 });
  });

  test('wrong password is rejected', async ({ page }) => {
    const email = uniq();
    await register(page, email);
    await page.goto('/');
    await page.getByTestId('logout').click();
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('wrongpassword');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText(/incorrect/i);
  });

  test('a second user cannot access a private project but can after it is shared', async ({ browser, request }) => {
    // Alice (API) creates a project
    const alice = await browser.newContext();
    const aEmail = uniq();
    const reg = await alice.request.post('/api/auth/register', { data: { email: aEmail, password: 'password123', name: 'Alice' } });
    expect(reg.ok()).toBeTruthy();
    const proj = await (await alice.request.post('/api/projects', { data: { name: 'Alice Secret' } })).json();

    // Bob cannot open it
    const bob = await browser.newContext();
    const bEmail = uniq();
    await bob.request.post('/api/auth/register', { data: { email: bEmail, password: 'password123' } });
    const denied = await bob.request.get(`/api/projects/${proj.id}`);
    expect(denied.status()).toBe(403);

    // Alice shares with Bob
    const shared = await alice.request.post(`/api/projects/${proj.id}/share`, { data: { mode: 'private', collaborators: [bEmail] } });
    expect(shared.ok()).toBeTruthy();

    // Bob can now open it and it shows in his list
    const allowed = await bob.request.get(`/api/projects/${proj.id}`);
    expect(allowed.ok()).toBeTruthy();
    const bobList = await (await bob.request.get('/api/projects')).json();
    expect(bobList.some((p: { id: string }) => p.id === proj.id)).toBeTruthy();

    // Bob cannot delete (owner-only)
    const del = await bob.request.delete(`/api/projects/${proj.id}`);
    expect(del.status()).toBe(403);

    await alice.close();
    await bob.close();
  });

  test('percent-encoded project id cannot bypass the access guard (C1)', async ({ browser }) => {
    const alice = await browser.newContext();
    await alice.request.post('/api/auth/register', { data: { email: uniq(), password: 'password123' } });
    const proj = await (await alice.request.post('/api/projects', { data: { name: 'Alice C1' } })).json();

    const bob = await browser.newContext();
    await bob.request.post('/api/auth/register', { data: { email: uniq(), password: 'password123' } });
    // encode the first character of the id — the old raw-URL regex would skip the guard
    const enc = '%' + proj.id.charCodeAt(0).toString(16) + proj.id.slice(1);
    const res = await bob.request.get(`/api/projects/${enc}`);
    expect(res.status()).toBe(403);
    await alice.close();
    await bob.close();
  });

  test('imported projects are owned (not world-accessible) (H1)', async ({ browser }) => {
    const alice = await browser.newContext();
    await alice.request.post('/api/auth/register', { data: { email: uniq(), password: 'password123' } });
    // minimal zip built inline
    const { execSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papyr-imp-'));
    fs.writeFileSync(path.join(tmp, 'main.tex'), '\\documentclass{article}\\begin{document}x\\end{document}');
    execSync(`cd ${tmp} && zip -q -r p.zip main.tex`);
    const b64 = fs.readFileSync(path.join(tmp, 'p.zip')).toString('base64');
    const proj = await (await alice.request.post('/api/projects/import', { data: { name: 'Imported', zipBase64: b64 } })).json();
    fs.rmSync(tmp, { recursive: true, force: true });

    const bob = await browser.newContext();
    await bob.request.post('/api/auth/register', { data: { email: uniq(), password: 'password123' } });
    expect((await bob.request.get(`/api/projects/${proj.id}`)).status()).toBe(403);
    expect((await bob.request.delete(`/api/projects/${proj.id}`)).status()).toBe(403);
    await alice.close();
    await bob.close();
  });

  test('project id path traversal is rejected in comments (H2)', async ({ browser }) => {
    const alice = await browser.newContext();
    await alice.request.post('/api/auth/register', { data: { email: uniq(), password: 'password123' } });
    // traversal id targeting the users store — must not read/write outside the comments dir
    const res = await alice.request.get('/api/projects/..%2f..%2fusers/comments');
    expect([400, 403, 404].includes(res.status())).toBeTruthy();
    await alice.close();
  });
});

test.describe('abuse controls', () => {
  test('login is rate-limited after repeated failures', async ({ request }) => {
    const email = uniq();
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await request.post('/api/auth/login', { data: { email, password: 'definitely-wrong' } });
      if (res.status() === 429) { got429 = true; break; }
    }
    expect(got429).toBeTruthy();
  });
});

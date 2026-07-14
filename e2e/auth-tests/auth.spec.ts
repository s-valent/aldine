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
  // wait for a signed-in-only control — NOT .home__brand, which also renders on
  // the login screen (so it wouldn't confirm the session actually established).
  await expect(page.getByTestId('new-project')).toBeVisible({ timeout: 15_000 });
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
    // isolate this test's limiter bucket via a dedicated client IP (server runs with TRUST_PROXY=1)
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 15; i++) {
      const res = await request.post('/api/auth/login', { headers, data: { email, password: 'definitely-wrong' } });
      if (res.status() === 429) { got429 = true; break; }
    }
    expect(got429).toBeTruthy();
  });
});

test.describe('auth depth', () => {
  test('logout revokes the session server-side (stale cookie is invalid)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const email = uniq();
    await ctx.request.post('/api/auth/register', { data: { email, password: 'password123' } });
    // capture the session cookie, then log out
    const cookies = await ctx.cookies();
    const session = cookies.find((c) => c.name === 'papyr_session');
    expect(session).toBeTruthy();
    await ctx.request.post('/api/auth/logout');
    // replay the stale cookie in a fresh context → must be rejected (revoked)
    const stale = await browser.newContext();
    await stale.addCookies([{ name: 'papyr_session', value: session!.value, url: 'http://localhost:3200' }]);
    const me = await (await stale.request.get('/api/auth/me')).json();
    expect(me.user).toBeNull();
    await ctx.close(); await stale.close();
  });

  test('changing password revokes other sessions', async ({ browser }) => {
    const email = uniq();
    const s1 = await browser.newContext();
    await s1.request.post('/api/auth/register', { data: { email, password: 'password123' } });
    const s2 = await browser.newContext();
    await s2.request.post('/api/auth/login', { data: { email, password: 'password123' } });
    // s2 changes the password → s1's session should be revoked
    await s2.request.post('/api/auth/password', { data: { currentPassword: 'password123', newPassword: 'newpassword456' } });
    const s1me = await (await s1.request.get('/api/auth/me')).json();
    expect(s1me.user).toBeNull();
    // and the new password works
    const relog = await s1.request.post('/api/auth/login', { data: { email, password: 'newpassword456' } });
    expect(relog.ok()).toBeTruthy();
    await s1.close(); await s2.close();
  });

  test('forgot-password → reset flow works from the login screen', async ({ page }) => {
    const email = uniq();
    // register then sign out
    await register(page, email);
    await page.goto('/');
    await page.getByTestId('logout').click();
    // forgot flow (self-host echo returns the token → reset mode)
    await page.getByTestId('auth-forgot').click();
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-token')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('auth-token')).not.toHaveValue('', { timeout: 10_000 });
    await page.getByTestId('auth-password').fill('brandnewpass1');
    await page.getByTestId('auth-submit').click();
    // back to login; sign in with the new password
    await expect(page.getByTestId('auth-info')).toContainText(/updated/i, { timeout: 10_000 });
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('brandnewpass1');
    await page.getByTestId('auth-submit').click();
    await expect(page.locator('.home__brand')).toBeVisible({ timeout: 15_000 });
  });

  test('SSO endpoints 404 when unconfigured and no buttons show', async ({ page, request }) => {
    for (const p of ['github', 'google']) {
      expect((await request.get(`/api/auth/oauth/${p}`, { maxRedirects: 0 })).status()).toBe(404);
    }
    await page.goto('/');
    await expect(page.getByTestId('auth-email')).toBeVisible();
    await expect(page.getByTestId('oauth-github')).toHaveCount(0);
    await expect(page.getByTestId('oauth-google')).toHaveCount(0);
  });

  test('change password from account settings revokes other sessions', async ({ page, browser, request }) => {
    const email = uniq();
    await register(page, email);
    // a second session for the same account (should be revoked by the change)
    const other = await browser.newContext();
    await other.request.post('/api/auth/login', { data: { email, password: 'password123' } });

    // open account settings and change the password
    await page.getByTestId('user-name').click();
    await expect(page.getByTestId('account-settings')).toBeVisible();
    await page.getByTestId('current-password').fill('password123');
    await page.getByTestId('new-password').fill('changed-pw-99');
    await page.getByTestId('save-password').click();

    // the other session is now revoked
    await expect.poll(async () => (await (await other.request.get('/api/auth/me')).json()).user).toBeNull();
    // and the new password works
    expect((await request.post('/api/auth/login', { data: { email, password: 'changed-pw-99' } })).ok()).toBeTruthy();
    await other.close();
  });
});

test.describe('plan metering', () => {
  test('/api/usage requires sign-in and reports compile usage', async ({ browser }) => {
    const anon = await browser.newContext();
    expect((await anon.request.get('/api/usage')).status()).toBe(401);
    const ctx = await browser.newContext();
    await ctx.request.post('/api/auth/register', { data: { email: uniq(), password: 'password123' } });
    const u = await (await ctx.request.get('/api/usage')).json();
    expect(typeof u.seconds).toBe('number');
    expect(typeof u.quotaSeconds).toBe('number');
    expect(typeof u.metering).toBe('boolean');
    expect(u.month).toMatch(/^\d{4}-\d{2}$/);
    await anon.close(); await ctx.close();
  });
});

test.describe('collab under auth', () => {
  test('opening a file loads its content (collab socket authenticates)', async ({ page, request }) => {
    const email = uniq();
    await register(page, email);
    const proj = await (await page.request.post('/api/projects', { data: { name: 'Collab Auth' } })).json();
    await page.request.put(`/api/projects/${proj.id}/file`, { data: { branch: 'main', path: 'paper/chapters/five.tex', content: 'LOADED-UNDER-AUTH-42\n' } });
    await page.goto(`/p/${proj.id}`);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('file-paper/chapters/five.tex').click();
    // before the token fix this stayed blank (collab never authenticated)
    await expect(page.locator('.cm-content')).toContainText('LOADED-UNDER-AUTH-42', { timeout: 15_000 });
  });
});

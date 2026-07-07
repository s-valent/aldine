import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = new URL('./shots/', import.meta.url).pathname;
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();

const shoot = async (ctx, name, fn) => {
  const page = await ctx.newPage();
  await fn(page);
  await page.screenshot({ path: OUT + name + '.png', fullPage: false });
  await page.close();
  console.log('shot:', name);
};

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });

  // seed a paper project
  const res = await ctx.request.post(`${BASE}/api/projects`, { data: { name: 'GSaaS Threat Model (IAC-26)' } });
  const { id } = await res.json();
  for (const f of ['main.tex', 'references.bib', 'iac.cls', 'iac.bbx', 'iac.cbx']) {
    const content = fs.readFileSync(`/Users/rahloff/projects/paper-gsaas-2026/paper/${f}`, 'utf8');
    await ctx.request.put(`${BASE}/api/projects/${id}/file`, { data: { branch: 'main', path: f, content } });
  }

  await shoot(ctx, `home-${scheme}`, async (p) => { await p.goto(BASE); await p.waitForSelector('.project-card'); await p.waitForTimeout(400); });
  await shoot(ctx, `editor-${scheme}`, async (p) => {
    await p.goto(`${BASE}/p/${id}`);
    await p.waitForSelector('.cm-content');
    await p.waitForSelector('canvas.pdf-page', { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(600);
  });
  await shoot(ctx, `branches-${scheme}`, async (p) => {
    await p.goto(`${BASE}/p/${id}`);
    await p.waitForSelector('.cm-content');
    await p.getByTestId('branch-menu').click();
    await p.waitForTimeout(300);
  });
  await shoot(ctx, `zotero-${scheme}`, async (p) => {
    await p.goto(`${BASE}/p/${id}`);
    await p.waitForSelector('.cm-content');
    await p.getByTestId('tab-plugin:zotero').click();
    await p.waitForTimeout(400);
  });
  await shoot(ctx, `history-${scheme}`, async (p) => {
    await p.goto(`${BASE}/p/${id}`);
    await p.waitForSelector('.cm-content');
    await p.getByRole('tab', { name: 'History' }).click();
    await p.waitForTimeout(400);
  });
  await ctx.request.delete(`${BASE}/api/projects/${id}`);
  await ctx.close();
}
await browser.close();

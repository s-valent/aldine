import { test, expect } from '../fixtures';
import { createProject, openProject, cleanup } from './helpers';

test.describe('plugin system', () => {
  test('registry lists plugins with manifests', async ({ request }) => {
    const res = await request.get('/api/plugins');
    expect(res.ok()).toBeTruthy();
    const plugins = await res.json();
    expect(Array.isArray(plugins)).toBeTruthy();
    const zotero = plugins.find((p: { id: string }) => p.id === 'zotero');
    expect(zotero).toBeTruthy();
    expect(zotero.entry).toBe('index.js');
    expect(zotero.version).toBeTruthy();
  });

  test('plugin entry is served as an ES module and registers UI', async ({ page, request }) => {
    const res = await request.get('/plugins/zotero/index.js');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('javascript');

    const id = await createProject(request, 'Plugin Host Test');
    try {
      await openProject(page, id);
      await expect(page.getByTestId('tab-plugin:zotero')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('tab-plugin:zotero').click();
      await expect(page.getByTestId('zotero-panel')).toBeVisible();
    } finally {
      await cleanup(request, id);
    }
  });
});

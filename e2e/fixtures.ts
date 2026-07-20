import { test as base, expect } from '@playwright/test';

/**
 * Shared test base: every page starts with the first-run onboarding already
 * dismissed, so UI tests that click Home controls aren't blocked by the modal.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => window.localStorage.setItem('aldine.onboarded', '1'));
    await use(page);
  },
});

export { expect };

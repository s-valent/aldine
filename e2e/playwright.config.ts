import { defineConfig } from '@playwright/test';

/**
 * E2E suite. Assumes:
 *  - compiler service on :4020 (docker container or `npm run dev:compiler`)
 *  - it starts the app server (:3100), a mock Zotero API (:4919) and Vite preview itself
 * Set ALDINE_URL to test an already-running stack (e.g. docker compose on :8080);
 * webServers are skipped via reuseExistingServer when ports are taken.
 */
const BASE = process.env.ALDINE_URL || 'http://localhost:3100';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: process.env.ALDINE_URL ? undefined : [
    {
      command: 'node tests/mock-zotero.mjs',
      port: 4919,
      reuseExistingServer: true,
      timeout: 10_000,
    },
    {
      // OPENROUTER_API_KEY/OPENAI_API_KEY are emptied so an ambient key can't
      // override the mock Anthropic endpoint the AI-fix test relies on.
      command: 'npm run build -w apps/web && PORT=3100 DATA_DIR=$(pwd)/.data-e2e OPENROUTER_API_KEY= OPENAI_API_KEY= ZOTERO_API_BASE=http://localhost:4919 DOI_API_BASE=http://localhost:4919 ARXIV_API_BASE=http://localhost:4919 OPENALEX_API_BASE=http://localhost:4919 ANTHROPIC_API_KEY=test-ai-key ANTHROPIC_BASE_URL=http://localhost:4919 npx tsx apps/server/src/index.ts',
      cwd: '..',
      port: 3100,
      reuseExistingServer: true,
      timeout: 600_000,
    },
  ],
});

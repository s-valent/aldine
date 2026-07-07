import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export const config = {
  port: Number(process.env.PORT || 3000),
  /** Root for project git repos: <dataDir>/projects/<id> */
  dataDir: process.env.DATA_DIR || path.join(repoRoot, '.data'),
  /** Shared with compiler service; PDFs land here */
  cacheDir: process.env.CACHE_DIR || path.join(repoRoot, '.cache/latex'),
  compilerUrl: process.env.COMPILER_URL || 'http://localhost:4020',
  /** Built-in + user plugins */
  pluginsDir: process.env.PLUGINS_DIR || path.join(repoRoot, 'plugins'),
  templatesDir: process.env.TEMPLATES_DIR || path.join(repoRoot, 'templates'),
  webDist: process.env.WEB_DIST || path.join(repoRoot, 'apps/web/dist'),
};

export const projectsDir = path.join(config.dataDir, 'projects');
export const worktreesDir = path.join(config.dataDir, 'worktrees');
export const metaDir = path.join(config.dataDir, 'meta');

for (const d of [projectsDir, worktreesDir, metaDir, config.cacheDir]) {
  fs.mkdirSync(d, { recursive: true });
}

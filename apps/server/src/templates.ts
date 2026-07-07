import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface TemplateInfo { id: string; name: string; description?: string; icon?: string; order?: number }

export function listTemplates(): TemplateInfo[] {
  const dir = config.templatesDir;
  if (!fs.existsSync(dir)) return [];
  const out: TemplateInfo[] = [];
  for (const name of fs.readdirSync(dir)) {
    const metaPath = path.join(dir, name, 'template.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as TemplateInfo;
      meta.id = meta.id || name;
      out.push(meta);
    } catch { /* skip broken template */ }
  }
  return out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** All files of a template (except template.json), as relative-path → content. */
export function templateFiles(id: string): Record<string, string> {
  if (id.includes('..') || id.includes('/')) throw new Error('bad template id');
  const base = path.join(config.templatesDir, id);
  if (!fs.existsSync(path.join(base, 'template.json'))) throw new Error(`unknown template: ${id}`);
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(relPath);
      else if (relPath !== 'template.json') files[relPath] = fs.readFileSync(path.join(base, relPath), 'utf8');
    }
  };
  walk('');
  return files;
}

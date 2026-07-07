import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  /** entry ES module, relative to the plugin dir; loaded by the frontend at runtime */
  entry: string;
  icon?: string; // emoji or asset path
  /** declared extension slots, informational */
  slots?: string[];
  enabled?: boolean;
}

export function listPlugins(): PluginManifest[] {
  const dir = config.pluginsDir;
  if (!fs.existsSync(dir)) return [];
  const out: PluginManifest[] = [];
  for (const name of fs.readdirSync(dir)) {
    const manifestPath = path.join(dir, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
      manifest.id = manifest.id || name;
      manifest.enabled = manifest.enabled !== false;
      out.push(manifest);
    } catch (err) {
      console.error(`[plugins] bad manifest for ${name}:`, err);
    }
  }
  return out;
}

export function pluginAssetPath(pluginId: string, rel: string): string | null {
  if (pluginId.includes('..') || rel.includes('..')) return null;
  const abs = path.join(config.pluginsDir, pluginId, rel);
  if (!abs.startsWith(config.pluginsDir + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

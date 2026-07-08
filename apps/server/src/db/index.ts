import { config } from '../config.js';
import type { DataStore } from './types.js';
import { JsonStore } from './json.js';
import { PgStore } from './pg.js';

export * from './types.js';

let store: DataStore | null = null;

/** Pick the backend from the environment: DATABASE_URL → Postgres, else JSON. */
export async function initDb(): Promise<DataStore> {
  if (store) return store;
  const url = process.env.DATABASE_URL;
  store = url ? new PgStore(url) : new JsonStore(config.metaRoot);
  await store.init();
  console.log(`[papyr] datastore: ${url ? 'postgres' : 'json'}`);
  return store;
}

/** The active DataStore. Throws if used before initDb() (a startup ordering bug). */
export function db(): DataStore {
  if (!store) throw new Error('datastore not initialized — call initDb() at startup');
  return store;
}

/** Test/shutdown helper. */
export async function closeDb(): Promise<void> {
  await store?.close();
  store = null;
}

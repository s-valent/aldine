/**
 * Single home for Redis connections. Every consumer (rate limiting, the
 * Hocuspocus collab extension, cross-node project events) builds its clients
 * here, so URL semantics (rediss:// TLS, ACL username, /db, query params —
 * all parsed natively by ioredis from the raw URL), retry policy, and error
 * handling exist exactly once.
 *
 * ioredis is an optionalDependency: everything degrades to single-node
 * in-memory behavior when it is missing, with one warning at boot.
 */

/** Structural type only — never import ioredis types (optional dependency). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  on(event: string, cb: (...args: any[]) => void): RedisLike;
  options: Record<string, unknown>;
  quit(): Promise<unknown>;
}

type RedisCtor = new (url: string, opts?: Record<string, unknown>) => RedisLike;

let IORedisCtor: RedisCtor | null = null;
if (process.env.REDIS_URL) {
  try {
    const mod = await import('ioredis');
    IORedisCtor = ((mod as any).default ?? (mod as any).Redis) as RedisCtor;
  } catch {
    console.warn('[aldine] REDIS_URL is set but ioredis is not installed — Redis features disabled (single-node)');
  }
}

/** True when REDIS_URL is set AND ioredis resolved. */
export function redisAvailable(): boolean {
  return !!IORedisCtor;
}

/**
 * Build a client from an explicit URL. Pure w.r.t. the environment so the
 * URL semantics are unit-testable (pass { lazyConnect: true } to build
 * without connecting). Returns null when ioredis is unavailable.
 */
export function buildClient(url: string, purpose: string, overrides?: Record<string, unknown>): RedisLike | null {
  if (!IORedisCtor) return null;
  const client = new IORedisCtor(url, { maxRetriesPerRequest: 2, ...overrides });
  client.on('error', (e: Error) => console.error(`[aldine] redis(${purpose}) error:`, e.message));
  return client;
}

let shared: RedisLike | null = null;

/**
 * Lazy singleton for command-mode use (rate limiting, publishes). NOT usable
 * for subscribe — a subscribed ioredis connection refuses regular commands.
 */
export function getSharedRedis(): RedisLike | null {
  if (!process.env.REDIS_URL || !IORedisCtor) return null;
  return (shared ??= buildClient(process.env.REDIS_URL, 'shared'));
}

/**
 * Fresh dedicated connection from REDIS_URL — required for subscribe mode and
 * for the Hocuspocus extension's createClient hook (called once per pub/sub
 * connection it needs).
 */
export function createDedicatedClient(purpose: string, overrides?: Record<string, unknown>): RedisLike | null {
  if (!process.env.REDIS_URL) return null;
  return buildClient(process.env.REDIS_URL, purpose, overrides);
}

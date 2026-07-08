/**
 * Tiny in-memory rate limiter (token bucket per key). No external deps, no
 * Redis — fine for a single-node self-host. Keys are usually `${route}:${ip}`
 * or `${route}:${userId}`.
 */

interface Bucket { tokens: number; last: number }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private capacity: number, private refillPerSec: number) {
    // opportunistic cleanup so the map can't grow unbounded
    setInterval(() => this.sweep(), 300_000).unref?.();
  }

  /** Returns true if allowed (and consumes a token), false if rate-limited. */
  take(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSec);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private sweep(now = Date.now()): void {
    for (const [k, b] of this.buckets) {
      if (b.tokens >= this.capacity && now - b.last > 600_000) this.buckets.delete(k);
    }
  }
}

/** A gate that allows at most `max` concurrent operations per key. */
export class ConcurrencyGate {
  private active = new Map<string, number>();
  constructor(private max: number) {}
  tryAcquire(key: string): boolean {
    const n = this.active.get(key) || 0;
    if (n >= this.max) return false;
    this.active.set(key, n + 1);
    return true;
  }
  release(key: string): void {
    const n = (this.active.get(key) || 1) - 1;
    if (n <= 0) this.active.delete(key); else this.active.set(key, n);
  }
}

// Shared limiters (tuned for a small self-hosted deployment; override via env).
const n = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

/** login: 10 attempts, refill 1 / 30s → slows brute force without annoying real users. */
export const loginLimiter = new RateLimiter(n(process.env.RL_LOGIN_BURST, 10), 1 / 30);
/** AI fix: 20 burst, refill 1 / 12s (≈5/min sustained) — bounds LLM spend per client. */
export const aiLimiter = new RateLimiter(n(process.env.RL_AI_BURST, 20), n(process.env.RL_AI_REFILL_PER_MIN, 5) / 60);
/** reference lookups (DOI/OpenAlex): 30 burst, 1/2s. */
export const refLimiter = new RateLimiter(n(process.env.RL_REF_BURST, 30), 0.5);
/** at most 2 concurrent compiles per client. */
export const compileGate = new ConcurrencyGate(n(process.env.RL_COMPILE_CONCURRENCY, 2));

export function clientKey(req: { headers: Record<string, unknown>; ip?: string }, userId?: string): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd as string))?.split(',')[0]?.trim() || req.ip || 'unknown';
  return `ip:${ip}`;
}

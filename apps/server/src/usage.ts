import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Per-user compile-time metering — the basis for billable plan tiers. Compiles
 * are the real cost driver (CPU + RAM bursts), so we meter compile-seconds per
 * calendar month rather than seats.
 *
 * Off by default: only enforced when PAPYR_COMPILE_QUOTA_MIN (monthly minutes)
 * is set AND the request is from a signed-in user. Self-host stays unmetered.
 */

const usagePath = path.join(config.metaRoot, 'usage.json');

interface Entry { month: string; seconds: number }
type Store = Record<string, Entry>;

function load(): Store {
  try { return JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch { return {}; }
}
function save(s: Store): void {
  const tmp = `${usagePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, usagePath);
}

/** Current calendar month as YYYY-MM (UTC), passed in so callers control the clock. */
export function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Monthly compile-minutes quota, or 0 when metering is disabled. */
export function quotaSeconds(): number {
  const min = Number(process.env.PAPYR_COMPILE_QUOTA_MIN || 0);
  return Number.isFinite(min) && min > 0 ? min * 60 : 0;
}
export function meteringEnabled(): boolean {
  return quotaSeconds() > 0;
}

function current(userId: string, now: Date): Entry {
  const store = load();
  const e = store[userId];
  const month = monthKey(now);
  return e && e.month === month ? e : { month, seconds: 0 };
}

/** Seconds consumed this month, and the quota, for a user. */
export function usageFor(userId: string, now = new Date()): { month: string; seconds: number; quotaSeconds: number } {
  const e = current(userId, now);
  return { month: e.month, seconds: Math.round(e.seconds), quotaSeconds: quotaSeconds() };
}

/** True if the user has already met or exceeded this month's quota. */
export function overQuota(userId: string, now = new Date()): boolean {
  const q = quotaSeconds();
  if (q <= 0) return false;
  return current(userId, now).seconds >= q;
}

/** Add compile time to a user's monthly tally (resets automatically on a new month). */
export function recordCompile(userId: string, ms: number, now = new Date()): void {
  if (!(ms > 0)) return;
  const store = load();
  const month = monthKey(now);
  const e = store[userId];
  store[userId] = e && e.month === month
    ? { month, seconds: e.seconds + ms / 1000 }
    : { month, seconds: ms / 1000 };
  save(store);
}

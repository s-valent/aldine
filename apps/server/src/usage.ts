import { db } from './db/index.js';

/**
 * Per-user compile-time metering — the basis for billable plan tiers. Compiles
 * are the real cost driver (CPU + RAM bursts), so we meter compile-seconds per
 * calendar month rather than seats. Persisted through the DataStore.
 *
 * Off by default: only enforced when ALDINE_COMPILE_QUOTA_MIN (monthly minutes)
 * is set AND the request is from a signed-in user. Self-host stays unmetered.
 */

/** Current calendar month as YYYY-MM (UTC), passed in so callers control the clock. */
function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Monthly compile-minutes quota, or 0 when metering is disabled. */
function quotaSeconds(): number {
  const min = Number(process.env.ALDINE_COMPILE_QUOTA_MIN || 0);
  return Number.isFinite(min) && min > 0 ? min * 60 : 0;
}
export function meteringEnabled(): boolean {
  return quotaSeconds() > 0;
}

/** Seconds consumed this month, and the quota, for a user. */
export async function usageFor(userId: string, now = new Date()): Promise<{ month: string; seconds: number; quotaSeconds: number }> {
  const month = monthKey(now);
  const seconds = await db().getUsageSeconds(userId, month);
  return { month, seconds: Math.round(seconds), quotaSeconds: quotaSeconds() };
}

/** True if the user has already met or exceeded this month's quota. */
export async function overQuota(userId: string, now = new Date()): Promise<boolean> {
  const q = quotaSeconds();
  if (q <= 0) return false;
  return (await db().getUsageSeconds(userId, monthKey(now))) >= q;
}

/** Add compile time to a user's monthly tally (a new month starts fresh). */
export async function recordCompile(userId: string, ms: number, now = new Date()): Promise<void> {
  if (!(ms > 0)) return;
  await db().addUsageSeconds(userId, monthKey(now), ms / 1000);
}

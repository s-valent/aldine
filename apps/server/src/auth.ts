import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Optional, env-gated auth (AUTH_ENABLED=1). When off, every request is
 * anonymous with full access and none of this runs — the single-tenant default.
 *
 * Sessions are now server-side and REVOCABLE: a random opaque session id lives
 * in an HttpOnly cookie and maps to a stored record. Logout, password change,
 * and reset all delete sessions. Passwords are scrypt-hashed. No external deps.
 * Users, sessions, and reset tokens live in the secrets volume.
 */

export const AUTH_ENABLED = process.env.AUTH_ENABLED === '1' || process.env.AUTH_ENABLED === 'true';
export const COOKIE = 'papyr_session';
const SESSION_DAYS = 30;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface User { id: string; email: string; name: string; salt: string; hash: string; createdAt: string; provider?: string }
export interface PublicUser { id: string; email: string; name: string }

const usersPath = path.join(config.metaRoot, 'users.json');
const sessionsPath = path.join(config.metaRoot, 'sessions.json');
const resetsPath = path.join(config.metaRoot, 'resets.json');

function readJson<T>(p: string, dflt: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
}
function writeJson(p: string, v: unknown): void {
  fs.writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 });
}

const loadUsers = () => readJson<Record<string, User>>(usersPath, {});
const saveUsers = (u: Record<string, User>) => writeJson(usersPath, u);

interface Session { userId: string; exp: number }
const loadSessions = () => readJson<Record<string, Session>>(sessionsPath, {});
const saveSessions = (s: Record<string, Session>) => writeJson(sessionsPath, s);

interface Reset { userId: string; exp: number }
const loadResets = () => readJson<Record<string, Reset>>(resetsPath, {});
const saveResets = (r: Record<string, Reset>) => writeJson(resetsPath, r);

export function pub(u: User): PublicUser { return { id: u.id, email: u.email, name: u.name }; }

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password: string, user: User): boolean {
  const attempt = hashPassword(password, user.salt);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findByEmail(email: string): User | undefined {
  email = email.trim().toLowerCase();
  return Object.values(loadUsers()).find((u) => u.email === email);
}

export function register(email: string, password: string, name?: string, provider?: string): PublicUser {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');
  if (!provider && password.length < 8) throw new Error('Password must be at least 8 characters');
  const users = loadUsers();
  if (Object.values(users).some((u) => u.email === email)) throw new Error('An account with that email already exists');
  const salt = crypto.randomBytes(16).toString('hex');
  const user: User = {
    id: crypto.randomBytes(9).toString('base64url'),
    email,
    name: (name || email.split('@')[0]).trim(),
    salt,
    hash: password ? hashPassword(password, salt) : '',
    createdAt: new Date().toISOString(),
    provider,
  };
  users[user.id] = user;
  saveUsers(users);
  return pub(user);
}

export function login(email: string, password: string): PublicUser {
  const user = findByEmail(email);
  if (!user || !user.hash || !verifyPassword(password, user)) throw new Error('Incorrect email or password');
  return pub(user);
}

export function getUser(id: string): User | null {
  return loadUsers()[id] || null;
}

/** Find an OAuth user by email or create one (no password). */
export function findOrCreateOAuth(email: string, name: string, provider: string): PublicUser {
  const existing = findByEmail(email);
  if (existing) return pub(existing);
  return register(email, '', name, provider);
}

export function changePassword(userId: string, current: string, next: string): void {
  if (next.length < 8) throw new Error('New password must be at least 8 characters');
  const users = loadUsers();
  const user = users[userId];
  if (!user) throw new Error('User not found');
  if (user.hash && !verifyPassword(current, user)) throw new Error('Current password is incorrect');
  user.salt = crypto.randomBytes(16).toString('hex');
  user.hash = hashPassword(next, user.salt);
  saveUsers(users);
  revokeUser(userId); // sign out everywhere; caller re-issues the current session
}

/** Create a reset token. Returns {token} for self-host relay; caller may also email it. */
export function requestReset(email: string): { token: string; user: PublicUser } | null {
  const user = findByEmail(email);
  if (!user) return null; // do not leak which emails exist
  const token = crypto.randomBytes(24).toString('base64url');
  const resets = loadResets();
  resets[token] = { userId: user.id, exp: Date.now() + RESET_TTL_MS };
  saveResets(resets);
  return { token, user: pub(user) };
}

export function resetPassword(token: string, next: string): void {
  if (next.length < 8) throw new Error('New password must be at least 8 characters');
  const resets = loadResets();
  const r = resets[token];
  if (!r || r.exp < Date.now()) throw new Error('This reset link is invalid or has expired');
  const users = loadUsers();
  const user = users[r.userId];
  if (!user) throw new Error('User not found');
  user.salt = crypto.randomBytes(16).toString('hex');
  user.hash = hashPassword(next, user.salt);
  saveUsers(users);
  delete resets[token];
  saveResets(resets);
  revokeUser(user.id);
}

// ---------- sessions (revocable) ----------
export function createSession(userId: string): string {
  const sid = crypto.randomBytes(24).toString('base64url');
  const sessions = loadSessions();
  pruneSessions(sessions);
  sessions[sid] = { userId, exp: Date.now() + SESSION_DAYS * 864e5 };
  saveSessions(sessions);
  return sid;
}

export function destroySession(sid: string | undefined): void {
  if (!sid) return;
  const sessions = loadSessions();
  if (sessions[sid]) { delete sessions[sid]; saveSessions(sessions); }
}

export function revokeUser(userId: string): void {
  const sessions = loadSessions();
  let changed = false;
  for (const [sid, s] of Object.entries(sessions)) {
    if (s.userId === userId) { delete sessions[sid]; changed = true; }
  }
  if (changed) saveSessions(sessions);
}

function pruneSessions(sessions: Record<string, Session>): void {
  const now = Date.now();
  for (const [sid, s] of Object.entries(sessions)) if (s.exp < now) delete sessions[sid];
}

export function verifyToken(sid: string | undefined): PublicUser | null {
  if (!sid) return null;
  const sessions = loadSessions();
  const s = sessions[sid];
  if (!s || s.exp < Date.now()) return null;
  const user = getUser(s.userId);
  return user ? pub(user) : null;
}

// ---------- cookies ----------
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function sessionCookie(sid: string): string {
  return `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}
export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
export function sidFromRequest(cookieHeader: string | undefined): string | undefined {
  return parseCookies(cookieHeader)[COOKIE];
}
export function userFromRequest(cookieHeader: string | undefined): PublicUser | null {
  if (!AUTH_ENABLED) return null;
  return verifyToken(sidFromRequest(cookieHeader));
}

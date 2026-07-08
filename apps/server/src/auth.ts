import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Optional, env-gated auth (AUTH_ENABLED=1). When off, every request is
 * anonymous with full access and none of this runs — the single-tenant default.
 *
 * Users live in the secrets volume (never the compiler-shared data volume).
 * Sessions are stateless: an HMAC-signed cookie {userId, exp}. Passwords are
 * scrypt-hashed. Zero external dependencies.
 */

export const AUTH_ENABLED = process.env.AUTH_ENABLED === '1' || process.env.AUTH_ENABLED === 'true';
export const COOKIE = 'papyr_session';

export interface User { id: string; email: string; name: string; salt: string; hash: string; createdAt: string }
export interface PublicUser { id: string; email: string; name: string }

const usersPath = path.join(config.metaRoot, 'users.json');
const secretPath = path.join(config.metaRoot, 'auth-secret');

function loadSecret(): string {
  const env = process.env.AUTH_SECRET;
  if (env) return env;
  try { return fs.readFileSync(secretPath, 'utf8'); } catch { /* create below */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, s, { mode: 0o600 });
  return s;
}
const SECRET = AUTH_ENABLED ? loadSecret() : 'disabled';

function loadUsers(): Record<string, User> {
  try { return JSON.parse(fs.readFileSync(usersPath, 'utf8')); } catch { return {}; }
}
function saveUsers(u: Record<string, User>): void {
  fs.writeFileSync(usersPath, JSON.stringify(u, null, 2), { mode: 0o600 });
}

export function pub(u: User): PublicUser { return { id: u.id, email: u.email, name: u.name }; }

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function register(email: string, password: string, name?: string): PublicUser {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const users = loadUsers();
  if (Object.values(users).some((u) => u.email === email)) throw new Error('An account with that email already exists');
  const salt = crypto.randomBytes(16).toString('hex');
  const user: User = {
    id: crypto.randomBytes(9).toString('base64url'),
    email,
    name: (name || email.split('@')[0]).trim(),
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  users[user.id] = user;
  saveUsers(users);
  return pub(user);
}

export function login(email: string, password: string): PublicUser {
  email = email.trim().toLowerCase();
  const users = loadUsers();
  const user = Object.values(users).find((u) => u.email === email);
  if (!user) throw new Error('Incorrect email or password');
  const attempt = hashPassword(password, user.salt);
  if (!crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(user.hash, 'hex'))) {
    throw new Error('Incorrect email or password');
  }
  return pub(user);
}

export function getUser(id: string): User | null {
  return loadUsers()[id] || null;
}

// ---------- tokens ----------
function sign(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

export function mintToken(userId: string, days = 30): string {
  const exp = Date.now() + days * 864e5;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): PublicUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  const expected = sign(`${userId}.${exp}`);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const user = getUser(userId);
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

export function sessionCookie(token: string, days = 30): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}`;
}
export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function userFromRequest(cookieHeader: string | undefined): PublicUser | null {
  if (!AUTH_ENABLED) return null;
  return verifyToken(parseCookies(cookieHeader)[COOKIE]);
}

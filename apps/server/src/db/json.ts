import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECT_ID_RE } from '../util.js';
import type { DataStore, User, SessionRow, ProjectMeta, Comment } from './types.js';

/**
 * Flat-JSON DataStore — the slim, zero-dependency default for single-node
 * self-hosting. Preserves the historical on-disk layout so existing
 * deployments keep working:
 *   <metaRoot>/users.json  sessions.json  resets.json  usage.json
 *   <metaRoot>/meta/<id>.json          (project metadata)
 *   <metaRoot>/comments/<id>.json      (review comments)
 * Writes are atomic (temp + rename). Node's synchronous fs calls don't
 * interleave, so a single process is race-free; multi-node needs Postgres.
 */
export class JsonStore implements DataStore {
  private usersPath: string;
  private sessionsPath: string;
  private resetsPath: string;
  private usagePath: string;
  private connectionsPath: string;
  private metaDir: string;
  private commentsDir: string;

  constructor(private metaRoot: string) {
    this.usersPath = path.join(metaRoot, 'users.json');
    this.sessionsPath = path.join(metaRoot, 'sessions.json');
    this.resetsPath = path.join(metaRoot, 'resets.json');
    this.usagePath = path.join(metaRoot, 'usage.json');
    this.connectionsPath = path.join(metaRoot, 'connections.json');
    this.metaDir = path.join(metaRoot, 'meta');
    this.commentsDir = path.join(metaRoot, 'comments');
  }

  async init(): Promise<void> {
    for (const d of [this.metaRoot, this.metaDir, this.commentsDir]) fs.mkdirSync(d, { recursive: true });
  }
  async close(): Promise<void> {}

  private read<T>(p: string, dflt: T): T {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
  }
  private write(p: string, v: unknown): void {
    const tmp = `${p}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, p);
  }

  // ---- users ----
  private users() { return this.read<Record<string, User>>(this.usersPath, {}); }
  async createUser(u: User) { const m = this.users(); m[u.id] = u; this.write(this.usersPath, m); }
  async updateUser(u: User) { const m = this.users(); m[u.id] = u; this.write(this.usersPath, m); }
  async getUser(id: string) { return this.users()[id] || null; }
  async findUserByEmail(email: string) { return Object.values(this.users()).find((u) => u.email === email) || null; }

  // ---- sessions ----
  private sessions() { return this.read<Record<string, SessionRow>>(this.sessionsPath, {}); }
  async createSession(sid: string, userId: string, exp: number) {
    const s = this.sessions();
    const now = Date.now();
    for (const [k, v] of Object.entries(s)) if (v.exp < now) delete s[k]; // opportunistic prune
    s[sid] = { userId, exp };
    this.write(this.sessionsPath, s);
  }
  async getSession(sid: string) { const s = this.sessions()[sid]; return s || null; }
  async deleteSession(sid: string) { const s = this.sessions(); if (s[sid]) { delete s[sid]; this.write(this.sessionsPath, s); } }
  async deleteSessionsForUser(userId: string) {
    const s = this.sessions(); let changed = false;
    for (const [k, v] of Object.entries(s)) if (v.userId === userId) { delete s[k]; changed = true; }
    if (changed) this.write(this.sessionsPath, s);
  }

  // ---- resets ----
  private resets() { return this.read<Record<string, SessionRow>>(this.resetsPath, {}); }
  async createReset(token: string, userId: string, exp: number) {
    const r = this.resets();
    const now = Date.now();
    for (const [t, v] of Object.entries(r)) if (v.exp < now) delete r[t];
    r[token] = { userId, exp };
    this.write(this.resetsPath, r);
  }
  async getReset(token: string) { return this.resets()[token] || null; }
  async deleteReset(token: string) { const r = this.resets(); if (r[token]) { delete r[token]; this.write(this.resetsPath, r); } }

  // ---- project meta ----
  private metaPath(id: string) { if (!PROJECT_ID_RE.test(id)) throw new Error('bad project id'); return path.join(this.metaDir, `${id}.json`); }
  async readMeta(id: string) { try { return JSON.parse(fs.readFileSync(this.metaPath(id), 'utf8')) as ProjectMeta; } catch { return null; } }
  async writeMeta(meta: ProjectMeta) { this.write(this.metaPath(meta.id), meta); }
  async deleteMeta(id: string) { fs.rmSync(this.metaPath(id), { force: true }); }
  async listMeta() {
    if (!fs.existsSync(this.metaDir)) return [];
    return fs.readdirSync(this.metaDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.metaDir, f), 'utf8')) as ProjectMeta)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---- comments ----
  private commentPath(id: string) { if (!PROJECT_ID_RE.test(id)) throw new Error('bad project id'); return path.join(this.commentsDir, `${id}.json`); }
  async loadComments(projectId: string) { try { return JSON.parse(fs.readFileSync(this.commentPath(projectId), 'utf8')) as Comment[]; } catch { return []; } }
  async saveComments(projectId: string, list: Comment[]) { this.write(this.commentPath(projectId), list); }

  // ---- connections ----
  private connections() { return this.read<Record<string, Record<string, Record<string, unknown>>>>(this.connectionsPath, {}); }
  async getConnection(userId: string, provider: string) { return this.connections()[userId]?.[provider] || null; }
  async setConnection(userId: string, provider: string, data: Record<string, unknown>) {
    const c = this.connections();
    (c[userId] ||= {})[provider] = data;
    this.write(this.connectionsPath, c);
  }
  async deleteConnection(userId: string, provider: string) {
    const c = this.connections();
    if (c[userId]?.[provider]) { delete c[userId][provider]; this.write(this.connectionsPath, c); }
  }

  // ---- usage ----
  private usage() { return this.read<Record<string, { month: string; seconds: number }>>(this.usagePath, {}); }
  async getUsageSeconds(userId: string, month: string) { const e = this.usage()[userId]; return e && e.month === month ? e.seconds : 0; }
  async addUsageSeconds(userId: string, month: string, seconds: number) {
    const u = this.usage();
    const e = u[userId];
    u[userId] = e && e.month === month ? { month, seconds: e.seconds + seconds } : { month, seconds };
    this.write(this.usagePath, u);
  }
}

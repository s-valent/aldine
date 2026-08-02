import { AUTH_ENABLED, PublicUser, getUser } from './auth.js';
import { ProjectMeta } from './store.js';

/** May this user open/edit this project? Open to all when auth is disabled. */
export function canAccess(meta: ProjectMeta, user: PublicUser | null): boolean {
  if (!AUTH_ENABLED) return true;
  if (!meta.ownerId) return true;      // legacy project created before auth
  if (!user) return false;
  if (meta.ownerId === user.id) return true;
  if (meta.share?.mode === 'link') return true;
  const email = user.email.toLowerCase();
  return !!meta.share?.collaborators?.some((c) => c.toLowerCase() === email);
}

/**
 * Should this project appear in the user's project list? Stricter than
 * canAccess: link-mode grants access when the URL is opened, but must not
 * surface the project on every signed-in user's home screen.
 */
export function isListed(meta: ProjectMeta, user: PublicUser | null): boolean {
  if (!AUTH_ENABLED) return true;
  if (!meta.ownerId) return true;      // legacy project created before auth
  if (!user) return false;
  if (meta.ownerId === user.id) return true;
  const email = user.email.toLowerCase();
  return !!meta.share?.collaborators?.some((c) => c.toLowerCase() === email);
}

/** Only the owner may change sharing / delete. */
export function isOwner(meta: ProjectMeta, user: PublicUser | null): boolean {
  if (!AUTH_ENABLED) return true;
  if (!meta.ownerId) return true;
  return !!user && meta.ownerId === user.id;
}

/** Resolve the owner's display name for listings (best-effort). */
export async function ownerName(meta: ProjectMeta): Promise<string | undefined> {
  if (!meta.ownerId) return undefined;
  return (await getUser(meta.ownerId))?.name;
}

import { useCallback, useEffect, useState } from 'react';
import { api, InviteInfo } from '../api';
import { useToast } from './Toast';
import Modal from './Modal';

/**
 * Admin-only invite manager (invite-only registration). Lists every invite with
 * its usage status, creates single-use invite links (optionally bound to one
 * email / expiring), copies them, and revokes.
 */
export default function InvitesModal({ onClose }: { onClose(): void }) {
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try { setInvites((await api.listInvites()).invites); }
    catch (err: any) { toast(`Could not load invites: ${err.message}`, 'error'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast('Invite link copied', 'ok'); }
    catch { toast('Could not copy — select the link and copy manually', 'error'); }
  };

  const create = async () => {
    const trimmed = email.trim();
    if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) { toast('Enter a valid email address to bind the invite to', 'error'); return; }
    const d = days.trim();
    if (d && (!/^\d+$/.test(d) || Number(d) < 1 || Number(d) > 365)) { toast('Expiry must be a number of days between 1 and 365', 'error'); return; }
    setBusy(true);
    try {
      const inv = await api.createInvite(trimmed || undefined, d ? Number(d) : undefined);
      setEmail(''); setDays('');
      await copyLink(inv.url);
      await load();
    } catch (err: any) {
      toast(`Could not create invite: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    try {
      await api.revokeInvite(token);
      toast('Invite deleted', 'ok');
      await load();
    } catch (err: any) {
      toast(`Could not delete invite: ${err.message}`, 'error');
    }
  };

  const fmt = (inv: InviteInfo) => {
    const expires = inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : 'never';
    const used = inv.usedAt ? `used ${new Date(inv.usedAt).toLocaleDateString()}` : inv.expiresAt && inv.expiresAt < Date.now() ? 'expired' : 'unused';
    return { expires, used };
  };

  return (
    <Modal onClose={onClose} label="Invites" width={560} testId="invites-modal">
      <div>
        <h2>Invites</h2>
        <p className="modal__sub">Registration is invite-only. Create single-use links — bound to an email or open to anyone, optionally expiring.</p>

        <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          <input className="input" style={{ flex: 1.4 }} placeholder="Email (optional — invite works only for this address)" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invite-email" />
          <input className="input" style={{ width: 90 }} placeholder="Days" title="Expires after N days (blank = never)" value={days} onChange={(e) => setDays(e.target.value)} data-testid="invite-days" />
          <button className="btn btn--primary" onClick={create} disabled={busy} data-testid="invite-create">
            {busy ? '…' : 'Create link'}
          </button>
        </div>

        {invites.length === 0 && <p className="modal__sub">No invites yet — create your first link above.</p>}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
          {invites.map((inv) => {
            const s = fmt(inv);
            return (
              <li key={inv.token} className="conflict__list" style={{ fontSize: 12, margin: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.url.replace(/^.*\?invite=/, '')}</code>
                  <span style={{ color: inv.usedAt ? 'var(--text-2)' : 'var(--ok)', whiteSpace: 'nowrap' }}>{s.used}</span>
                  <button className="btn btn--ghost" style={{ height: 24, padding: '0 8px', fontSize: 12 }} onClick={() => copyLink(inv.url)}>Copy</button>
                  <button className="btn btn--ghost" style={{ height: 24, padding: '0 8px', fontSize: 12 }} onClick={() => revoke(inv.token)} title="Delete this invite">Delete</button>
                </div>
                <div style={{ color: 'var(--text-2)', marginTop: 2 }}>
                  {inv.email ? `for ${inv.email} · ` : 'open to anyone · '}created {new Date(inv.createdAt).toLocaleDateString()} · expires {s.expires}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="modal__actions">
          <button className="btn" onClick={onClose} data-testid="invites-close">Done</button>
        </div>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from './Toast';

/** Toolbar control for a GitHub-linked project: ahead/behind, push (with a commit
 *  message), pull (with conflict handling), and an opt-in auto-sync. */
export default function GithubSync({ projectId, fullName, onPulled }: { projectId: string; fullName: string; onPulled(): void }) {
  const [status, setStatus] = useState<{ ahead: number; behind: number } | null>(null);
  const [busy, setBusy] = useState<'' | 'push' | 'pull' | 'status' | 'reset'>('');
  const [showPush, setShowPush] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [auto, setAuto] = useState(() => localStorage.getItem(`papyr.autopush.${projectId}`) === '1');
  const toast = useToast();

  const refresh = useCallback(async () => {
    try { const s = await api.projectGithubStatus(projectId); setStatus({ ahead: s.ahead, behind: s.behind }); }
    catch { /* offline / no token — hide counts */ }
  }, [projectId]);
  useEffect(() => { refresh(); }, [refresh]);

  const doPush = async (msg?: string) => {
    setBusy('push'); setShowPush(false);
    try { await api.githubPush(projectId, msg); if (msg !== undefined) toast('Pushed to GitHub', 'ok'); await refresh(); }
    catch (err: any) { toast(err.message, 'error'); }
    setBusy('');
  };

  const pull = async () => {
    setBusy('pull');
    try {
      const r = await api.githubPull(projectId);
      if (r.conflict) { setConflicts(r.conflicts || []); }
      else { toast('Pulled from GitHub', 'ok'); onPulled(); await refresh(); }
    } catch (err: any) { toast(err.message, 'error'); }
    setBusy('');
  };

  const takeRemote = async () => {
    setBusy('reset');
    try { await api.githubResetToRemote(projectId); toast('Reset to the GitHub version', 'ok'); setConflicts(null); onPulled(); await refresh(); }
    catch (err: any) { toast(err.message, 'error'); }
    setBusy('');
  };

  // auto-sync: while enabled, periodically flush+commit+push local changes
  const autoRef = useRef(auto); autoRef.current = auto;
  useEffect(() => {
    localStorage.setItem(`papyr.autopush.${projectId}`, auto ? '1' : '0');
    if (!auto) return;
    const t = setInterval(() => { if (autoRef.current && !busyRef.current) doPush(); }, 20_000);
    return () => clearInterval(t);
  }, [auto, projectId]);
  const busyRef = useRef(busy); busyRef.current = busy;

  return (
    <div className="gh-sync" data-testid="github-sync" title={`Synced with ${fullName}`}>
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="gh-sync__counts" data-testid="github-counts">
          {status.ahead > 0 && <span title={`${status.ahead} local commit(s) to push`}>↑{status.ahead}</span>}
          {status.behind > 0 && <span title={`${status.behind} remote commit(s) to pull`}>↓{status.behind}</span>}
        </span>
      )}
      <button className={`gh-sync__auto ${auto ? 'gh-sync__auto--on' : ''}`} onClick={() => setAuto((v) => !v)} data-testid="github-auto" title="Auto-sync: push local changes to GitHub every 20s">
        {auto ? '⟳ Auto' : '⟳'}
      </button>
      <button className="btn btn--small" onClick={pull} disabled={!!busy} data-testid="github-pull-btn" title="Pull from GitHub">{busy === 'pull' ? '…' : 'Pull'}</button>
      <button className="btn btn--small" onClick={() => { setMessage('Update from Papyr'); setShowPush(true); }} disabled={!!busy} data-testid="github-push-btn" title="Push to GitHub">{busy === 'push' ? '…' : 'Push'}</button>

      {showPush && (
        <div className="modal-backdrop" onClick={() => setShowPush(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()} data-testid="push-dialog">
            <h2 style={{ marginBottom: 8 }}>Push to GitHub</h2>
            <p className="modal__sub" style={{ marginBottom: 10 }}>{fullName}</p>
            <input className="input" style={{ width: '100%' }} value={message} data-testid="push-message" autoFocus
              onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doPush(message.trim() || 'Update from Papyr')} placeholder="Commit message" />
            <div className="modal__row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowPush(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => doPush(message.trim() || 'Update from Papyr')} data-testid="push-confirm">Commit &amp; push</button>
            </div>
          </div>
        </div>
      )}

      {conflicts && (
        <div className="modal-backdrop" onClick={() => setConflicts(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} data-testid="conflict-dialog">
            <h2 style={{ marginBottom: 8 }}>Merge conflict</h2>
            <p className="modal__sub">Your changes and GitHub's have diverged{conflicts.length ? ' in:' : '.'}</p>
            {conflicts.length > 0 && <ul className="conflict__list">{conflicts.map((f) => <li key={f}>{f}</li>)}</ul>}
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
              Papyr kept your local version. You can discard your local changes and take GitHub's version, or cancel and reconcile manually (push, then resolve on GitHub).
            </p>
            <div className="modal__row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setConflicts(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={takeRemote} disabled={busy === 'reset'} data-testid="conflict-take-remote">Discard local &amp; take GitHub's</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

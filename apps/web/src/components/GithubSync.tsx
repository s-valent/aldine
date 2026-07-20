import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from './Toast';

/** Toolbar control for a GitHub-linked project: branch switch/create + PR,
 *  ahead/behind, push (with a commit message), pull (with conflict handling),
 *  and an opt-in auto-sync. */
export default function GithubSync({ projectId, fullName, onPulled }: { projectId: string; fullName: string; onPulled(): void }) {
  const [status, setStatus] = useState<{ ahead: number; behind: number } | null>(null);
  const [busy, setBusy] = useState<'' | 'push' | 'pull' | 'reset' | 'branch'>('');
  const [showPush, setShowPush] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [auto, setAuto] = useState(() => localStorage.getItem(`aldine.autopush.${projectId}`) === '1');
  // branches
  const [branchInfo, setBranchInfo] = useState<{ branches: string[]; current: string; default: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [newName, setNewName] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [showPr, setShowPr] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try { const s = await api.projectGithubStatus(projectId); setStatus({ ahead: s.ahead, behind: s.behind }); }
    catch { /* offline / no token */ }
  }, [projectId]);
  const loadBranches = useCallback(async () => {
    try { setBranchInfo(await api.githubBranches(projectId)); } catch { /* offline */ }
  }, [projectId]);
  useEffect(() => { refresh(); loadBranches(); }, [refresh, loadBranches]);

  const doPush = async (msg?: string, auto = false) => {
    setBusy('push'); setShowPush(false);
    try { await api.githubPush(projectId, msg, auto); if (msg !== undefined) toast('Pushed to GitHub', 'ok'); await refresh(); }
    catch (err: any) { toast(err.message, 'error'); }
    setBusy('');
  };
  const pull = async () => {
    setBusy('pull');
    try {
      const r = await api.githubPull(projectId);
      if (r.conflict) setConflicts(r.conflicts || []);
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
  const switchTo = async (branch: string) => {
    setMenu(false);
    if (branch === branchInfo?.current) return;
    setBusy('branch');
    try { await api.githubSwitchBranch(projectId, branch); toast(`Switched to ${branch}`, 'ok'); onPulled(); await loadBranches(); await refresh(); }
    catch (err: any) { toast(err.message, 'error'); }
    setBusy('');
  };
  const createBranch = async () => {
    const name = newName.trim(); if (!name) return;
    setBusy('branch'); setMenu(false); setNewName('');
    try { await api.githubCreateBranch(projectId, name); toast(`Created branch ${name}`, 'ok'); await loadBranches(); await refresh(); }
    catch (err: any) { toast(err.message, 'error'); }
    setBusy('');
  };
  const openPR = async () => {
    setShowPr(false);
    try { const pr = await api.githubOpenPR(projectId, prTitle.trim() || undefined); toast(`Opened PR #${pr.number}`, 'ok'); window.open(pr.url, '_blank', 'noopener'); }
    catch (err: any) { toast(err.message, 'error'); }
  };

  // auto-sync: while enabled, periodically flush+commit+push local changes
  const autoRef = useRef(auto); autoRef.current = auto;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    localStorage.setItem(`aldine.autopush.${projectId}`, auto ? '1' : '0');
    if (!auto) return;
    const t = setInterval(() => { if (autoRef.current && !busyRef.current) doPush(undefined, true); }, 20_000);
    return () => clearInterval(t);
  }, [auto, projectId]);

  const onDefault = branchInfo && branchInfo.current === branchInfo.default;

  return (
    <div className="gh-sync" data-testid="github-sync" title={`Synced with ${fullName}`}>
      {branchInfo && (
        <div className="gh-branch" onMouseLeave={() => setMenu(false)}>
          <button className="gh-branch__chip" onClick={() => setMenu((v) => !v)} disabled={busy === 'branch'} data-testid="github-branch" title="Switch or create a GitHub branch">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z"/></svg>
            {busy === 'branch' ? '…' : branchInfo.current}
          </button>
          {menu && (
            <div className="gh-branch__menu" data-testid="github-branch-menu">
              <div className="gh-branch__label">Switch branch</div>
              {branchInfo.branches.map((b) => (
                <button key={b} className={`gh-branch__item ${b === branchInfo.current ? 'is-current' : ''}`} onClick={() => switchTo(b)} data-testid={`github-branch-${b}`}>
                  {b}{b === branchInfo.default && <span className="gh-branch__tag">default</span>}
                </button>
              ))}
              <div className="gh-branch__sep" />
              <div className="gh-branch__new">
                <input className="input" placeholder="new-branch-name" value={newName} data-testid="github-new-branch" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createBranch()} />
                <button className="btn btn--small" onClick={createBranch} data-testid="github-create-branch">Create</button>
              </div>
              {!onDefault && <button className="gh-branch__item" onClick={() => { setMenu(false); setPrTitle(`Update ${branchInfo.current}`); setShowPr(true); }} data-testid="github-open-pr">Open pull request…</button>}
            </div>
          )}
        </div>
      )}

      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="gh-sync__counts" data-testid="github-counts">
          {status.ahead > 0 && <span title={`${status.ahead} local commit(s) to push`}>↑{status.ahead}</span>}
          {status.behind > 0 && <span title={`${status.behind} remote commit(s) to pull`}>↓{status.behind}</span>}
        </span>
      )}
      <button className={`gh-sync__auto ${auto ? 'gh-sync__auto--on' : ''}`} onClick={() => setAuto((v) => !v)} data-testid="github-auto" title="Auto-sync: push local changes to GitHub every 20s">{auto ? '⟳ Auto' : '⟳'}</button>
      <button className="btn btn--small" onClick={pull} disabled={!!busy} data-testid="github-pull-btn" title="Pull from GitHub">{busy === 'pull' ? '…' : 'Pull'}</button>
      <button className="btn btn--small" onClick={() => { setMessage('Update from Aldine'); setShowPush(true); }} disabled={!!busy} data-testid="github-push-btn" title="Push to GitHub">{busy === 'push' ? '…' : 'Push'}</button>

      {showPush && (
        <div className="modal-backdrop" onClick={() => setShowPush(false)}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()} data-testid="push-dialog">
            <h2 style={{ marginBottom: 8 }}>Push to GitHub</h2>
            <p className="modal__sub" style={{ marginBottom: 10 }}>{fullName} · {branchInfo?.current}</p>
            <input className="input" style={{ width: '100%' }} value={message} data-testid="push-message" autoFocus
              onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doPush(message.trim() || 'Update from Aldine')} placeholder="Commit message" />
            <div className="modal__row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowPush(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => doPush(message.trim() || 'Update from Aldine')} data-testid="push-confirm">Commit &amp; push</button>
            </div>
          </div>
        </div>
      )}

      {showPr && (
        <div className="modal-backdrop" onClick={() => setShowPr(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()} data-testid="pr-dialog">
            <h2 style={{ marginBottom: 8 }}>Open pull request</h2>
            <p className="modal__sub" style={{ marginBottom: 10 }}>{branchInfo?.current} → {branchInfo?.default}</p>
            <input className="input" style={{ width: '100%' }} value={prTitle} data-testid="pr-title" autoFocus onChange={(e) => setPrTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && openPR()} placeholder="Pull request title" />
            <div className="modal__row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShowPr(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={openPR} data-testid="pr-confirm">Open on GitHub</button>
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
              Aldine kept your local version. You can discard your local changes and take GitHub's version, or cancel and reconcile manually.
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

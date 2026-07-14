import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from './Toast';

/** Toolbar control for a GitHub-linked project: ahead/behind + push/pull. */
export default function GithubSync({ projectId, fullName, onPulled }: { projectId: string; fullName: string; onPulled(): void }) {
  const [status, setStatus] = useState<{ ahead: number; behind: number } | null>(null);
  const [busy, setBusy] = useState<'' | 'push' | 'pull' | 'status'>('');
  const toast = useToast();

  const refresh = useCallback(async () => {
    setBusy('status');
    try { const s = await api.projectGithubStatus(projectId); setStatus({ ahead: s.ahead, behind: s.behind }); }
    catch { /* offline or no token — leave counts hidden */ }
    setBusy('');
  }, [projectId]);
  useEffect(() => { refresh(); }, [refresh]);

  const push = async () => {
    setBusy('push');
    try { await api.githubPush(projectId); toast('Pushed to GitHub', 'ok'); await refresh(); }
    catch (err: any) { toast(err.message, 'error'); setBusy(''); }
  };
  const pull = async () => {
    setBusy('pull');
    try { await api.githubPull(projectId); toast('Pulled from GitHub', 'ok'); onPulled(); await refresh(); }
    catch (err: any) { toast(err.message?.includes('conflict') ? 'Pull hit a merge conflict — resolve locally' : err.message, 'error'); setBusy(''); }
  };

  return (
    <div className="gh-sync" data-testid="github-sync" title={`Synced with ${fullName}`}>
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="gh-sync__counts" data-testid="github-counts">
          {status.ahead > 0 && <span title={`${status.ahead} local commit(s) to push`}>↑{status.ahead}</span>}
          {status.behind > 0 && <span title={`${status.behind} remote commit(s) to pull`}>↓{status.behind}</span>}
        </span>
      )}
      <button className="btn btn--small" onClick={pull} disabled={!!busy} data-testid="github-pull-btn" title="Pull from GitHub">
        {busy === 'pull' ? '…' : 'Pull'}
      </button>
      <button className="btn btn--small" onClick={push} disabled={!!busy} data-testid="github-push-btn" title="Push to GitHub">
        {busy === 'push' ? '…' : 'Push'}
      </button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api, LogEntry, localUser } from '../api';
import { useToast } from './Toast';
import { friendlyDate } from '../util/dates';

export default function HistoryPanel({ projectId, branch }: { projectId: string; branch: string }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [msg, setMsg] = useState('');
  const toast = useToast();

  const load = () => api.log(projectId, branch).then(setLog).catch(() => setLog([]));
  useEffect(() => { load(); }, [projectId, branch]);

  const commit = async () => {
    const message = msg.trim() || 'Checkpoint';
    try {
      const res = await api.commit(projectId, branch, message, localUser().name);
      toast(res.committed ? 'Saved checkpoint' : 'No changes since last checkpoint', res.committed ? 'ok' : 'info');
      setMsg('');
      load();
    } catch (err: any) {
      toast(`Checkpoint failed: ${err.message}`, 'error');
    }
  };

  return (
    <div className="panel-list" data-testid="history-panel">
      <div style={{ display: 'flex', gap: 6, padding: '2px 0 8px' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Checkpoint message"
          value={msg}
          data-testid="commit-message"
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <button className="btn btn--small" onClick={commit} data-testid="commit-button" style={{ height: 28 }}>Save</button>
      </div>
      {log.map((c) => (
        <div key={c.hash} className="history__item" title={c.hash}>
          <div className="history__msg">{c.message}</div>
          <div className="history__meta">{c.author} · {friendlyDate(c.date)}</div>
        </div>
      ))}
      {log.length === 0 && <p style={{ color: 'var(--text-2)', padding: 8 }}>No history yet on this branch.</p>}
    </div>
  );
}

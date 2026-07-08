/** Renders a unified git patch with per-line coloring. */
export default function DiffView({ patch }: { patch: string }) {
  if (!patch.trim()) return <p style={{ color: 'var(--text-2)', fontSize: 13, padding: 8 }}>No changes in this commit.</p>;
  const lines = patch.split('\n');
  return (
    <pre className="diff" data-testid="diff-view">
      {lines.map((l, i) => {
        let cls = 'diff__ctx';
        if (l.startsWith('diff --git') || l.startsWith('index ') || l.startsWith('--- ') || l.startsWith('+++ ')) cls = 'diff__file';
        else if (l.startsWith('@@')) cls = 'diff__hunk';
        else if (l.startsWith('+')) cls = 'diff__add';
        else if (l.startsWith('-')) cls = 'diff__del';
        return <div key={i} className={cls}>{l || ' '}</div>;
      })}
    </pre>
  );
}

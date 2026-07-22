export interface PresenceUser { name: string; color: string }

export default function Presence({ users }: { users: PresenceUser[] }) {
  if (users.length <= 1) return null;
  return (
    <div className="presence" title={users.map((u) => u.name).join(', ')} data-testid="presence">
      {users.slice(0, 5).map((u, i) => (
        <span key={i} className="presence__avatar" title={u.name} aria-label={u.name} style={{ background: u.color }}>
          {u.name.trim().slice(0, 1).toUpperCase()}
        </span>
      ))}
      {users.length > 5 && <span className="presence__avatar" style={{ background: 'var(--text-3)' }}>+{users.length - 5}</span>}
    </div>
  );
}

export interface PresenceUser { name: string; color: string }

export default function Presence({ users }: { users: PresenceUser[] }) {
  if (users.length <= 1) return null;
  return (
    <div className="presence" title={users.map((u) => u.name).join(', ')} data-testid="presence">
      {users.slice(0, 5).map((u) => (
        <span key={u.name} className="presence__avatar" style={{ background: u.color }}>
          {u.name.trim().slice(0, 1).toUpperCase()}
        </span>
      ))}
      {users.length > 5 && <span className="presence__avatar" style={{ background: 'var(--text-3)' }}>+{users.length - 5}</span>}
    </div>
  );
}

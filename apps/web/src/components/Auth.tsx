import { createContext, useContext, useEffect, useState } from 'react';
import { api, AuthUser } from '../api';

interface AuthState {
  loading: boolean;
  authEnabled: boolean;
  user: AuthUser | null;
  setUser(u: AuthUser | null): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState>({ loading: true, authEnabled: false, user: null, setUser: () => {}, refresh: async () => {} });

export function useAuth() { return useContext(Ctx); }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = async () => {
    try {
      const me = await api.me();
      setAuthEnabled(me.authEnabled);
      setUser(me.user);
    } catch {
      setAuthEnabled(false);
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  if (loading) return <div style={{ height: '100%' }} />;

  if (authEnabled && !user) return <LoginScreen onAuthed={(u) => setUser(u)} />;

  return <Ctx.Provider value={{ loading, authEnabled, user, setUser, refresh }}>{children}</Ctx.Provider>;
}

function LoginScreen({ onAuthed }: { onAuthed(u: AuthUser): void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password, name.trim() || undefined);
      onAuthed(res.user);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <h1 className="home__brand" style={{ fontSize: 30, marginBottom: 2 }}>papyr<em>.</em></h1>
        <p className="home__tag" style={{ marginBottom: 18 }}>
          {mode === 'login' ? 'Sign in to your projects.' : 'Create an account to get started.'}
        </p>
        {mode === 'register' && (
          <input className="input login__input" placeholder="Name (optional)" value={name} data-testid="auth-name" onChange={(e) => setName(e.target.value)} />
        )}
        <input className="input login__input" type="email" placeholder="Email" value={email} data-testid="auth-email" autoFocus onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <input className="input login__input" type="password" placeholder="Password (min 8 characters)" value={password} data-testid="auth-password" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {error && <p className="login__error" data-testid="auth-error">{error}</p>}
        <button className="btn btn--primary login__submit" onClick={submit} disabled={busy} data-testid="auth-submit">
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button className="btn btn--ghost login__switch" data-testid="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

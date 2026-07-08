import { createContext, useContext, useEffect, useState } from 'react';
import { api, AuthUser } from '../api';

interface AuthState {
  loading: boolean;
  authEnabled: boolean;
  user: AuthUser | null;
  providers: string[];
  setUser(u: AuthUser | null): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState>({ loading: true, authEnabled: false, user: null, providers: [], setUser: () => {}, refresh: async () => {} });

export function useAuth() { return useContext(Ctx); }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<string[]>([]);

  const refresh = async () => {
    try {
      const me = await api.me();
      setAuthEnabled(me.authEnabled);
      setUser(me.user);
      setProviders(me.providers || []);
    } catch {
      setAuthEnabled(false);
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  if (loading) return <div style={{ height: '100%' }} />;

  if (authEnabled && !user) return <LoginScreen providers={providers} onAuthed={(u) => setUser(u)} />;

  return <Ctx.Provider value={{ loading, authEnabled, user, providers, setUser, refresh }}>{children}</Ctx.Provider>;
}

type Mode = 'login' | 'register' | 'forgot' | 'reset';

function LoginScreen({ providers, onAuthed }: { providers: string[]; onAuthed(u: AuthUser): void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setError(''); setInfo(''); };

  const submit = async () => {
    reset();
    setBusy(true);
    try {
      if (mode === 'login') onAuthed((await api.login(email.trim(), password)).user);
      else if (mode === 'register') onAuthed((await api.register(email.trim(), password, name.trim() || undefined)).user);
      else if (mode === 'forgot') {
        const r = await api.resetRequest(email.trim());
        if (r.token) { setToken(r.token); setMode('reset'); setInfo('Reset token issued (self-host mode). Set a new password below.'); }
        else { setInfo('If an account exists for that email, a reset link has been sent.'); }
        setBusy(false);
        return;
      } else if (mode === 'reset') {
        await api.resetPassword(token.trim(), password);
        setInfo('Password updated. You can sign in now.');
        setMode('login'); setPassword(''); setBusy(false);
        return;
      }
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const title = mode === 'login' ? 'Sign in to your projects.'
    : mode === 'register' ? 'Create an account to get started.'
    : mode === 'forgot' ? 'Reset your password.'
    : 'Set a new password.';

  return (
    <div className="login">
      <div className="login__card">
        <h1 className="home__brand" style={{ fontSize: 30, marginBottom: 2 }}>papyr<em>.</em></h1>
        <p className="home__tag" style={{ marginBottom: 18 }}>{title}</p>

        {providers.includes('github') && (mode === 'login' || mode === 'register') && (
          <>
            <a className="btn login__oauth" href="/api/auth/oauth/github" data-testid="oauth-github">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
              Continue with GitHub
            </a>
            <div className="login__or">or</div>
          </>
        )}

        {mode === 'register' && (
          <input className="input login__input" placeholder="Name (optional)" value={name} data-testid="auth-name" onChange={(e) => setName(e.target.value)} />
        )}
        {mode !== 'reset' && (
          <input className="input login__input" type="email" placeholder="Email" value={email} data-testid="auth-email" autoFocus onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}
        {mode === 'reset' && (
          <input className="input login__input" placeholder="Reset token" value={token} data-testid="auth-token" onChange={(e) => setToken(e.target.value)} />
        )}
        {mode !== 'forgot' && (
          <input className="input login__input" type="password" placeholder={mode === 'reset' ? 'New password (min 8)' : 'Password (min 8 characters)'} value={password} data-testid="auth-password" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        )}

        {error && <p className="login__error" data-testid="auth-error">{error}</p>}
        {info && <p className="login__info" data-testid="auth-info">{info}</p>}

        <button className="btn btn--primary login__submit" onClick={submit} disabled={busy} data-testid="auth-submit">
          {busy ? '…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Set password'}
        </button>

        {(mode === 'login' || mode === 'register') && (
          <button className="btn btn--ghost login__switch" data-testid="auth-switch" onClick={() => { reset(); setMode(mode === 'login' ? 'register' : 'login'); }}>
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
        )}
        {mode === 'login' && (
          <button className="btn btn--ghost login__switch" data-testid="auth-forgot" onClick={() => { reset(); setMode('forgot'); }}>Forgot password?</button>
        )}
        {(mode === 'forgot' || mode === 'reset') && (
          <button className="btn btn--ghost login__switch" onClick={() => { reset(); setMode('login'); }}>Back to sign in</button>
        )}
      </div>
    </div>
  );
}

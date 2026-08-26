import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { loadSession } from '../auth/session';
import { Brandmark } from '../components/Brandmark';
import { BRAND } from '../config/branding';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      const s = loadSession();
      navigate(s ? ROLE_HOME[s.role] : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-page p-6">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 flex justify-center">
          <Brandmark />
        </div>

        <div className="card">
          <h1 className="text-h2 font-semibold tracking-tight text-fg">Sign in</h1>
          <p className="mt-1 text-small text-fg-secondary">
            Your dashboard is chosen automatically from your account.
          </p>

          {error && (
            <div className="mt-4 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input id="email" type="email" autoComplete="email" required className="input"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" type="password" autoComplete="current-password" required className="input"
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
            </div>

            <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-4 text-center text-tiny text-fg-muted">
            Authorization is enforced server-side on every request.
          </p>
        </div>

        <p className="mt-6 text-center text-small text-fg-secondary">{BRAND.tagline}</p>
      </div>
    </div>
  );
}

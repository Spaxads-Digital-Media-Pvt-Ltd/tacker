import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { loadSession } from '../auth/session';
import { Brandmark } from '../components/Brandmark';
import { BRAND } from '../config/branding';

const FEATURES = [
  { title: 'Click → conversion', desc: 'Sub-30ms redirects, S2S postbacks.' },
  { title: 'Append-only ledger', desc: 'Every payout traceable, never edited.' },
  { title: 'AI ops copilot', desc: 'Read-only, tenant-scoped answers.' },
];

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
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-page px-6 py-12">
      {/* Faint paper texture: a wide, soft radial + hairline grid, kept subtle behind the card. */}
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)] opacity-[0.35]"
        style={{ backgroundImage: 'linear-gradient(rgb(var(--border)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border)) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="flex justify-center"><Brandmark /></div>
        <p className="mt-3 text-center text-small text-fg-secondary">{BRAND.tagline}</p>

        <form onSubmit={onSubmit} className="mt-8 animate-fade-in rounded-card border border-border bg-surface p-7 shadow-card">
          <h1 className="font-display text-h2 font-bold tracking-tight text-fg">Sign in</h1>
          <p className="mt-1 text-small text-fg-secondary">Your dashboard is chosen automatically from your account.</p>

          {error && (
            <div className="mt-4 rounded-[var(--radius)] border border-danger/30 bg-danger-bg px-4 py-3 text-small text-danger-text">
              {error}
            </div>
          )}

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
          <p className="mt-4 text-center text-tiny text-fg-muted">
            Authorization is enforced server-side on every request.
          </p>
        </form>

        <div className="mt-8 grid grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="text-center">
              <p className="text-tiny font-semibold text-fg">{f.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

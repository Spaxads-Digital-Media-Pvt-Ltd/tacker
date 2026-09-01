import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { loadSession } from '../auth/session';
import { Brandmark } from '../components/Brandmark';
import { BRAND } from '../config/branding';

/** Decorative "tracking flow" motif for the brand panel — clicks (small dots) travelling a rising
 * path and landing as a conversion (the larger dot). Pure token-free white-on-accent; sits behind
 * the panel copy at low opacity. */
function FlowGraphic() {
  return (
    <svg viewBox="0 0 400 300" fill="none" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="xMidYMid slice">
      <path d="M-20 250 C 60 250, 90 170, 160 150 S 280 120, 420 40" stroke="white" strokeOpacity="0.16" strokeWidth="2" />
      <path d="M-20 285 C 80 285, 120 215, 200 195 S 330 165, 440 90" stroke="white" strokeOpacity="0.10" strokeWidth="2" />
      {[[20, 244], [78, 214], [136, 170], [196, 152], [258, 128]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.5" fill="white" fillOpacity="0.5" />
      ))}
      <circle cx="330" cy="88" r="9" fill="white" fillOpacity="0.9" />
      <circle cx="330" cy="88" r="16" stroke="white" strokeOpacity="0.35" strokeWidth="2" />
    </svg>
  );
}

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
    <div className="flex min-h-full">
      {/* Brand panel — hidden below lg so small screens get a plain centred form. */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-400 to-brand-700 lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-12">
        <FlowGraphic />
        <div className="relative flex items-center gap-3 text-white">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
            </svg>
          </span>
          <span className="text-xl font-bold tracking-tight">{BRAND.name}</span>
        </div>
        <div className="relative max-w-md text-white">
          <h2 className="text-h1 font-bold leading-tight tracking-tight">
            Click tracking, conversion attribution, and an audited payout ledger.
          </h2>
          <p className="mt-3 text-body text-white/70">
            One platform for the whole affiliate money path — from the first click to the paid invoice.
          </p>
        </div>
        <p className="relative text-tiny text-white/60">
          Authorization is enforced server-side on every request.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex w-full items-center justify-center bg-page p-6 lg:w-1/2">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex justify-center lg:hidden">
            <Brandmark />
          </div>

          <div className="card !p-8">
            <h1 className="text-h1 font-bold tracking-tight text-fg">Sign in</h1>
            <p className="mt-1.5 text-small text-fg-secondary">
              Your dashboard is chosen automatically from your account.
            </p>

            {error && (
              <div className="mt-5 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text">
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
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label className="label !mb-0" htmlFor="password">Password</label>
                    <Link to="/forgot-password" className="text-tiny font-medium text-accent-text hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <input id="password" type="password" autoComplete="current-password" required className="input"
                    value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
              </div>

              <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mt-5 text-center text-tiny text-fg-muted lg:hidden">
              Authorization is enforced server-side on every request.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

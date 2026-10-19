import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { loadSession } from '../auth/session';
import { api } from '../lib/api';
import { Brandmark } from '../shared-components/primitives/Brandmark';
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

/** Why the last session ended (lib/api.ts sends people here with ?ended=<reason>). */
const ENDED: Record<string, string> = {
  account_inactive: 'Your account was set to inactive, so you have been signed out. Contact the network to re-enable it.',
  account_disabled: 'Your team account was disabled, so you have been signed out. Ask an admin of your network to re-enable it.',
  account_deleted: 'Your account no longer exists, so you have been signed out.',
  network_suspended: 'Your network has been suspended, so you have been signed out. Contact the platform administrator.',
  network_deleted: 'Your network has been deleted, so you have been signed out. It can still be restored for a while — contact the platform administrator if this is a mistake.',
  network_purged: 'Your network no longer exists — it was deleted and its data removed.',
  session_expired: 'Your sign-in ended. Please sign in again.',
};

export default function Login() {
  const { signIn, signInPlatform, completePlatformSignIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ended = ENDED[params.get('ended') ?? ''] ?? null;
  const resetDone = params.get('reset') === 'done';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Super Admins sign in against the platform-admin surface (F-05), not the tenant auth exchange.
  const [asSuperAdmin, setAsSuperAdmin] = useState(false);
  // Two-factor on: after the password, the authenticator code (or a recovery code).
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  /** Signed in: the first-sign-in password change, a Super Admin's role page, or the role's home. */
  const land = async () => {
    const s = loadSession();
    const home = s?.role === 'super_admin'
      ? await api.get<{ role?: { home?: string } }>('/platform/me').then((m) => m.role?.home ?? ROLE_HOME.super_admin).catch(() => ROLE_HOME.super_admin)
      : null;
    navigate(s?.mustChangePassword ? '/change-password' : home ?? (s ? ROLE_HOME[s.role] : '/'), { replace: true });
  };
  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      await completePlatformSignIn(challenge, code.trim());
      await land();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      if (/too long/i.test(msg)) { setChallenge(null); setCode(''); }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (asSuperAdmin) {
        const twoFactor = await signInPlatform(email, password);
        if (twoFactor) { setChallenge(twoFactor.challenge); setCode(''); return; }
      } else {
        await signIn(email, password);
      }
      // Platform staff land on their role's own panel (Sales → the sales dashboard, Support → the queue…).
      await land();
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
              {asSuperAdmin ? 'Super Admin console — platform operators only.' : 'Your dashboard is chosen automatically from your account.'}
            </p>

            {error ? (
              <div className="mt-5 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text">
                {error}
              </div>
            ) : ended ? (
              <div className="mt-5 rounded-[var(--radius)] border border-warning-bg bg-warning-bg px-4 py-3 text-small text-warning-text">
                {ended}
              </div>
            ) : resetDone && (
              <div className="mt-5 rounded-[var(--radius)] border border-success-bg bg-success-bg px-4 py-3 text-small text-success-text">
                Your password was updated. Sign in with the new one.
              </div>
            )}

            {challenge ? (
              <form onSubmit={onCode} className="mt-6 space-y-4">
                <p className="text-small text-fg-secondary">Two-factor sign-in is on for {email}. Enter the 6-digit code from your authenticator app — or one of your recovery codes.</p>
                <div>
                  <label className="label" htmlFor="code">Code</label>
                  <input id="code" className="input text-center font-mono text-lg tracking-[0.3em]" autoComplete="one-time-code" inputMode="text" required autoFocus
                    maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
                </div>
                <button type="submit" disabled={busy || code.trim().length < 6} className="btn-primary w-full">{busy ? 'Checking…' : 'Verify and sign in'}</button>
                <button type="button" className="w-full text-center text-tiny font-medium text-accent-text hover:underline" onClick={() => { setChallenge(null); setCode(''); setError(null); }}>Back</button>
              </form>
            ) : (
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
            )}

            {!challenge && <button type="button" onClick={() => { setAsSuperAdmin((v) => !v); setError(null); }}
              className="mt-4 w-full text-center text-tiny font-medium text-accent-text hover:underline">
              {asSuperAdmin ? 'Back to regular sign in' : 'Sign in as Super Admin'}
            </button>}

            {!asSuperAdmin && (
              <p className="mt-4 text-center text-tiny text-fg-secondary">
                New to {BRAND.name}? <Link to="/request-demo" className="font-medium text-accent-text hover:underline">Request a demo</Link>
              </p>
            )}

            <p className="mt-5 text-center text-tiny text-fg-muted lg:hidden">
              Authorization is enforced server-side on every request.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

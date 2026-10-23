import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { loadSession } from '../auth/session';
import { api } from '../lib/api';
import { AlertCircle } from 'lucide-react';
import { Brandmark } from '../shared-components/primitives/Brandmark';
import { Field } from '../shared-components/primitives/ui';
import { AuthSubmit } from '../shared-components/primitives/AuthCard';
import { BRAND } from '../config/branding';

/** Decorative "tracking flow" motif for the brand panel — clicks (small dots) travelling a rising
 * path and landing as a conversion (the larger dot). Drawn in currentColor (the panel's
 * --on-accent) at low opacity, flat — no gradients. Plays once (≈1.2 s, storyboard 30:8427):
 * curves rise in (0 / 120 ms), five clicks pop in from 250 ms (100 ms apart), the conversion dot
 * and ring land at 800 / 850 ms, then one ring pulse at 900 ms. Transform/opacity only; reduced
 * motion shows the final frame. Anchored to the lower part of the panel (Figma 29:8277), clear of the copy. */
const POP = 'animate-dot-pop [transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none';
const DOT_DELAYS = ['[animation-delay:250ms]', '[animation-delay:350ms]', '[animation-delay:450ms]', '[animation-delay:550ms]', '[animation-delay:650ms]'];
function FlowGraphic() {
  return (
    <svg viewBox="0 0 400 300" fill="none" className="absolute inset-x-0 bottom-0 h-[55%] w-full" aria-hidden preserveAspectRatio="xMidYMax slice">
      <path className="animate-curve-in motion-reduce:animate-none" d="M-20 250 C 60 250, 90 170, 160 150 S 280 120, 420 40" stroke="currentColor" strokeOpacity="0.16" strokeWidth="2" />
      <path className="animate-curve-in [animation-delay:120ms] motion-reduce:animate-none" d="M-20 285 C 80 285, 120 215, 200 195 S 330 165, 440 90" stroke="currentColor" strokeOpacity="0.10" strokeWidth="2" />
      {[[20, 244], [78, 214], [136, 170], [196, 152], [258, 128]].map(([cx, cy], i) => (
        <circle key={i} className={`${POP} ${DOT_DELAYS[i]}`} cx={cx} cy={cy} r="3.5" fill="currentColor" fillOpacity="0.5" />
      ))}
      <circle className={`${POP} [animation-delay:800ms]`} cx="330" cy="88" r="9" fill="currentColor" fillOpacity="0.9" />
      <circle className={`${POP} [animation-delay:850ms]`} cx="330" cy="88" r="16" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <circle className="animate-ring-pulse [animation-delay:900ms] [transform-box:fill-box] [transform-origin:center] motion-reduce:hidden" cx="330" cy="88" r="16" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
    </svg>
  );
}

/** Text link whose underline fades in on hover / keyboard focus (opacity only). */
const FADE_LINK = 'relative font-medium text-accent-text after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-current after:opacity-0 after:transition-opacity after:duration-base hover:after:opacity-100 focus-visible:after:opacity-100';

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
  const [shaking, setShaking] = useState(false);
  useEffect(() => { if (error) setShaking(true); }, [error]);

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
      {/* Brand panel — lg and up only; flat accent (no gradient), copy in --on-accent. */}
      <aside className="relative hidden overflow-hidden bg-accent text-on-accent lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-12">
        <FlowGraphic />
        <div className="relative flex animate-rise-in items-center gap-3 motion-reduce:animate-none">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-on-accent/15 ring-1 ring-inset ring-on-accent/25">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
            </svg>
          </span>
          <span className="text-xl font-bold tracking-tight">{BRAND.name}</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="animate-rise-in text-h1 font-bold leading-tight tracking-tight [animation-delay:70ms] motion-reduce:animate-none">
            Click tracking, conversion attribution, and an audited payout ledger.
          </h2>
          <p className="mt-3 animate-rise-in text-body [animation-delay:140ms] motion-reduce:animate-none">
            One platform for the whole affiliate money path — from the first click to the paid invoice.
          </p>
        </div>
        <p className="relative animate-rise-in text-tiny [animation-delay:210ms] motion-reduce:animate-none">
          Authorization is enforced server-side on every request.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex w-full min-w-0 flex-col items-center justify-center bg-page px-4 py-8 sm:p-6 lg:w-1/2">
        <div className="w-full max-w-sm animate-card-in motion-reduce:animate-none">
          <div className="mb-8 flex justify-center lg:hidden">
            <Brandmark />
          </div>

          <div className={`card !p-6 sm:!p-8 ${shaking ? 'animate-shake-x motion-reduce:animate-none' : ''}`}
            onAnimationEnd={(e) => { if (e.animationName === 'shake-x') setShaking(false); }}>
            <h1 className="text-h1 font-bold tracking-tight text-fg">Sign in</h1>
            <p className="mt-1.5 text-small text-fg-secondary">
              {asSuperAdmin ? 'Super Admin console — platform operators only.' : 'Your dashboard is chosen automatically from your account.'}
            </p>

            {/* Persistent live region: the error box fades in and is announced. */}
            <div aria-live="polite">
              {error ? (
                <div role="alert" className="mt-5 flex animate-error-in items-start gap-2 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text [overflow-wrap:anywhere] motion-reduce:animate-none">
                  <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{error}</span>
                </div>
              ) : ended ? (
                <div className="mt-5 rounded-[var(--radius)] border border-warning-bg bg-warning-bg px-4 py-3 text-small text-warning-text [overflow-wrap:anywhere]">
                  {ended}
                </div>
              ) : resetDone && (
                <div className="mt-5 rounded-[var(--radius)] border border-success-bg bg-success-bg px-4 py-3 text-small text-success-text [overflow-wrap:anywhere]">
                  Your password was updated. Sign in with the new one.
                </div>
              )}
            </div>

            {challenge ? (
              <form onSubmit={onCode} className="mt-6 space-y-4">
                <p className="text-small text-fg-secondary [overflow-wrap:anywhere]">Two-factor sign-in is on for {email}. Enter the 6-digit code from your authenticator app — or one of your recovery codes.</p>
                <Field label="Code">
                  <input id="code" className="input text-center font-mono text-lg tracking-[0.3em]" autoComplete="one-time-code" inputMode="text" required autoFocus
                    maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
                </Field>
                <AuthSubmit busy={busy} busyLabel="Checking…" disabled={busy || code.trim().length < 6}>Verify and sign in</AuthSubmit>
                <button type="button" className={`block w-full text-center text-tiny ${FADE_LINK}`} onClick={() => { setChallenge(null); setCode(''); setError(null); }}>Back</button>
              </form>
            ) : (
            <form onSubmit={onSubmit}>
              <div className="mt-6 space-y-4">
                <Field label="Email">
                  <input id="email" type="email" autoComplete="email" required className="input"
                    value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                </Field>
                <div>
                  <Field label="Password">
                    <input id="password" type="password" autoComplete="current-password" required className="input"
                      value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </Field>
                  <div className="mt-2 flex justify-end">
                    <Link to="/forgot-password" className={`text-tiny ${FADE_LINK}`}>
                      Forgot password?
                    </Link>
                  </div>
                </div>
              </div>

              <AuthSubmit busy={busy} busyLabel="Signing in…" className="mt-6">Sign in</AuthSubmit>
            </form>
            )}

            {!challenge && <button type="button" onClick={() => { setAsSuperAdmin((v) => !v); setError(null); }}
              className={`mx-auto mt-4 block text-center text-tiny ${FADE_LINK}`}>
              {asSuperAdmin ? 'Back to regular sign in' : 'Sign in as Super Admin'}
            </button>}

            {!asSuperAdmin && (
              <p className="mt-4 text-center text-tiny text-fg-secondary">
                New to {BRAND.name}? <Link to="/request-demo" className={FADE_LINK}>Request a demo</Link>
              </p>
            )}
          </div>

          {/* Below lg the hero (and its footnote) is hidden — the footnote sits under the card instead. */}
          <p className="mt-5 text-center text-tiny text-fg-muted lg:hidden">
            Authorization is enforced server-side on every request.
          </p>
        </div>
      </main>
    </div>
  );
}

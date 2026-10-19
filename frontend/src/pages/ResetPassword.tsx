import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { resetPassword } from '../auth/authClient';
import { ApiError } from '../lib/api';
import { PASSWORD_HINT, passwordProblem } from '../auth/passwordPolicy';
import { AuthCard, AuthError } from '../shared-components/primitives/AuthCard';

/**
 * The emailed reset link lands here (/reset-password?token=…, O1). The token is kept in memory and
 * dropped from the address bar; the new password and the token go to the API, which signs the
 * account out everywhere else. Then the person signs in with the new password.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(!token);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', '/reset-password');
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setError(null);
    setBusy(true);
    try {
      await resetPassword(token, password);
      navigate('/login?reset=done', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.details as { reason?: string } | undefined)?.reason === 'reset_link_invalid') setExpired(true);
      else setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (expired) {
    return (
      <AuthCard title="This link has expired">
        <p className="mt-3 text-small text-fg-secondary">
          Reset links work once and expire after 1 hour. Ask for a new one and use the latest email.
        </p>
        <Link to="/forgot-password" className="btn-primary mt-6 w-full">Send a new link</Link>
        <Link to="/login" className="btn-ghost mt-3 w-full">← Back to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle="You'll be signed out on your other devices.">
      {error && <AuthError>{error}</AuthError>}
      <form onSubmit={submit}>
        <div className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="password">New password</label>
            <input id="password" type="password" autoComplete="new-password" required className="input"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder={PASSWORD_HINT} />
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input id="confirm" type="password" autoComplete="new-password" required className="input"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">{busy ? 'Saving…' : 'Set new password'}</button>
      </form>
    </AuthCard>
  );
}

import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { changeInitialPassword } from '../auth/authClient';
import { PASSWORD_HINT, passwordProblem } from '../auth/passwordPolicy';
import { AuthCard, AuthError } from '../shared-components/primitives/AuthCard';

/**
 * First sign-in with an invite's temporary password (O1): choose your own before anything else —
 * the API refuses every other call until then (403 password_change_required sends people here).
 */
export default function ChangePassword() {
  const { session, reloadSession, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return <Navigate to="/login" replace />;
  if (!session.mustChangePassword) return <Navigate to={ROLE_HOME[session.role]} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setError(null);
    setBusy(true);
    try {
      await changeInitialPassword(password);
      reloadSession();
      navigate(ROLE_HOME[session.role], { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password');
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Choose your password" subtitle={<>You signed in with a temporary password. Choose your own to continue.</>}>
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
        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">{busy ? 'Saving…' : 'Save and continue'}</button>
      </form>
      <p className="mt-5 text-center text-tiny text-fg-muted">
        Signed in as {session.email} ·{' '}
        <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}>
          Sign out
        </button>
      </p>
    </AuthCard>
  );
}

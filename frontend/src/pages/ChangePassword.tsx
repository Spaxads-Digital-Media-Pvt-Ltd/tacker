import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { changeInitialPassword, PASSWORD_SAVED_SIGN_IN_AGAIN } from '../auth/authClient';
import { ApiError } from '../lib/api';
import { PASSWORD_HINT, passwordProblem } from '../auth/passwordPolicy';
import { AuthCard, AuthError, AuthSubmit } from '../shared-components/primitives/AuthCard';
import { Field } from '../shared-components/primitives/ui';

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
      // This sign-in is over (before or after the password was saved): never retry without one —
      // back to the login page, which says to use the new password when it was saved.
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
        navigate(err.code === PASSWORD_SAVED_SIGN_IN_AGAIN ? '/login?reset=done' : '/login?ended=session_expired', { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not update the password');
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Choose your password" subtitle={<>You signed in with a temporary password. Choose your own to continue.</>}>
      <AuthError>{error}</AuthError>
      <form onSubmit={submit}>
        <div className="mt-6 space-y-4">
          <Field label="New password">
            <input id="password" type="password" autoComplete="new-password" required className="input"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder={PASSWORD_HINT} />
          </Field>
          <Field label="Confirm new password">
            <input id="confirm" type="password" autoComplete="new-password" required className="input"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        <AuthSubmit busy={busy} busyLabel="Saving…" className="mt-6">Save and continue</AuthSubmit>
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

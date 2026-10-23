import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../auth/authClient';
import { AuthCard, AuthError, AuthSubmit } from '../shared-components/primitives/AuthCard';
import { Field } from '../shared-components/primitives/ui';

/**
 * "Forgot password?" (O1): emails a one-time link to choose a new password, through the account's
 * network mail settings. The answer is the same whether or not the address has an account.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthCard title="Check your email">
        <p className="mt-3 text-small text-fg-secondary">
          If <span className="font-medium text-fg">{sentTo}</span> has an account, we&rsquo;ve emailed it a link to choose a
          new password. The link works once and expires in 1 hour.
        </p>
        <p className="mt-3 text-tiny text-fg-muted">
          Nothing after a few minutes? Check your spam folder, or ask your account administrator.
        </p>
        <Link to="/login" className="btn-primary mt-6 w-full">Back to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter the email you sign in with and we'll send you a link to choose a new password.">
      <AuthError>{error}</AuthError>
      <form onSubmit={submit}>
        <div className="mt-6">
          <Field label="Email">
            <input id="email" type="email" autoComplete="email" required className="input"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
        </div>
        <AuthSubmit busy={busy} busyLabel="Sending…" className="mt-6">Send reset link</AuthSubmit>
      </form>
      <Link to="/login" className="btn-ghost mt-3 w-full">← Back to sign in</Link>
    </AuthCard>
  );
}

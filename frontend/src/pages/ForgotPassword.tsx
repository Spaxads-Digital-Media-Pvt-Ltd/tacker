import { Link } from 'react-router-dom';
import { Brandmark } from '../components/Brandmark';

/**
 * Placeholder destination for the login page's "Forgot password?" link. There is no self-serve
 * reset flow yet — that needs a backend endpoint (the SPA can't call Supabase Auth directly).
 * This screen states that honestly rather than presenting a form that goes nowhere.
 */
export default function ForgotPassword() {
  const support = `support@${typeof window !== 'undefined' ? window.location.hostname : 'tracker'}`;
  return (
    <div className="grid min-h-full place-items-center bg-page p-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex justify-center">
          <Brandmark />
        </div>
        <div className="card !p-8">
          <h1 className="text-h1 font-bold tracking-tight text-fg">Reset your password</h1>
          <p className="mt-3 text-small text-fg-secondary">
            Password resets aren&rsquo;t self-serve yet. Ask your account administrator to reset it,
            or email{' '}
            <a href={`mailto:${support}`} className="font-medium text-accent-text hover:underline">{support}</a>.
          </p>
          <Link to="/login" className="btn-ghost mt-6 w-full">← Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}

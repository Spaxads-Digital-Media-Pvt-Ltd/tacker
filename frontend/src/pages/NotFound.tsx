import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../auth/roles';
import { AuthCard } from '../shared-components/primitives/AuthCard';

/**
 * Any URL no route matches. The way out is the caller's own home (ROLE_HOME — the same place a
 * sign-in lands them, so a portal user never gets an /app/* link), or the sign-in page when signed out.
 */
export default function NotFound() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const home = session ? ROLE_HOME[session.role] : '/login';
  return (
    <AuthCard
      title="Page not found"
      subtitle={<>Nothing lives at <span className="break-all font-mono text-tiny text-fg">{pathname}</span>. It may have moved, or the link is mistyped.</>}
    >
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Link to={home} replace className="btn-primary flex-1">{session ? 'Go to your home page' : 'Go to sign in'}</Link>
        <button type="button" className="btn-ghost flex-1" onClick={() => window.history.back()}>Go back</button>
      </div>
    </AuthCard>
  );
}

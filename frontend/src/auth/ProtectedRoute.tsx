import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { ROLE_HOME, type Role } from './roles';

/**
 * Role-gated route wrapper (UX only — backend enforces authorization, spec §3A). Redirects to
 * login when signed out, or to the caller's own home when their role doesn't match the surface.
 */
export function ProtectedRoute({ allow, children }: { allow: Role; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (session.role !== allow) {
    return <Navigate to={ROLE_HOME[session.role]} replace />;
  }
  return <>{children}</>;
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { loadSession, type Session } from './session';
import * as authClient from './authClient';

interface AuthContextValue {
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Super Admin sign-in via the platform-admin surface (POST /platform/login). */
  /** Resolves with the two-factor challenge when the code step comes next (then completePlatformSignIn). */
  signInPlatform: (email: string, password: string) => Promise<authClient.TwoFactorChallenge | null>;
  completePlatformSignIn: (challenge: string, code: string) => Promise<{ usedRecoveryCode?: boolean; recoveryCodesLeft?: number }>;
  signOut: () => Promise<void>;
  /** Re-read the stored session (after the first-sign-in password change updated it). */
  reloadSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await authClient.login(email, password);
    setSession(next);
  }, []);

  const signInPlatform = useCallback(async (email: string, password: string) => {
    const next = await authClient.loginPlatform(email, password);
    if ('twoFactorRequired' in next) return next;
    setSession(next);
    return null;
  }, []);
  const completePlatformSignIn = useCallback(async (challenge: string, code: string) => {
    const next = await authClient.loginPlatformCode(challenge, code);
    const { recoveryCodesLeft, usedRecoveryCode, ...sessionOnly } = next;
    setSession(sessionOnly);
    return { recoveryCodesLeft, usedRecoveryCode };
  }, []);

  const signOut = useCallback(async () => {
    await authClient.logout();
    setSession(null);
  }, []);

  const reloadSession = useCallback(() => setSession(loadSession()), []);

  const value = useMemo(() => ({ session, signIn, signInPlatform, completePlatformSignIn, signOut, reloadSession }), [session, signIn, signInPlatform, completePlatformSignIn, signOut, reloadSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

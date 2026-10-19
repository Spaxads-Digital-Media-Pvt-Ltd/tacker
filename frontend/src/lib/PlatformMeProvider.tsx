/** Loads the platform staff member once for every Super Admin page (lib/platformMe.ts) and gates pages by role. */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from './useApi';
import { Spinner, StateBlock } from '../shared-components/primitives/ui';
import { PlatformMeContext, grants, usePlatformMe, type PlatformMe, type PlatformMeCtx } from './platformMe';
import { TwoFactorCard } from '../shared-components/panels/TwoFactorCard';

export function PlatformMeProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, refetch } = useQuery<PlatformMe>('/platform/me');
  const value = useMemo<PlatformMeCtx>(() => ({
    me: data, loading, error, refetch, can: (section, level = 'read') => grants(data?.permissions, section, level),
  }), [data, loading, error, refetch]);
  return <PlatformMeContext.Provider value={value}>{children}</PlatformMeContext.Provider>;
}

/** A Super Admin page only a role with `section` (read) may open (no section: every member, e.g. Tasks). */
export function PlatformGate({ section, children }: { section?: string; children: ReactNode }) {
  const { me, loading, error, can } = usePlatformMe();
  if (loading && !me) return <StateBlock><Spinner /></StateBlock>;
  if (error && !me) return <StateBlock>{error}</StateBlock>;
  // Required for every member and not set up yet: setting it up comes first (the API refuses the rest).
  if (me?.twoFactor?.required && !me.twoFactor.enabled) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-6">
        <h2 className="text-h2 font-semibold text-fg">Set up two-factor sign-in</h2>
        <p className="text-small text-fg-secondary">The platform requires it for every member of the team. It takes a minute with an authenticator app on your phone.</p>
        <TwoFactorCard />
      </div>
    );
  }
  if (section && !can(section)) {
    const name = me?.sections.find((s) => s.key === section)?.name ?? section;
    return <StateBlock>Your role ({me?.role.name ?? 'none'}) doesn’t include {name}. An Owner can change your role under Team & roles.</StateBlock>;
  }
  return <>{children}</>;
}

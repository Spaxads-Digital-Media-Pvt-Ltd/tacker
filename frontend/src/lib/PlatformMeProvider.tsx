/** Loads the platform staff member once for every Super Admin page (lib/platformMe.ts) and gates pages by role. */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from './useApi';
import { Spinner, StateBlock } from '../shared-components/primitives/ui';
import { PlatformMeContext, grants, usePlatformMe, type PlatformMe, type PlatformMeCtx } from './platformMe';

export function PlatformMeProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, refetch } = useQuery<PlatformMe>('/platform/me');
  const value = useMemo<PlatformMeCtx>(() => ({
    me: data, loading, error, refetch, can: (section, level = 'read') => grants(data?.permissions, section, level),
  }), [data, loading, error, refetch]);
  return <PlatformMeContext.Provider value={value}>{children}</PlatformMeContext.Provider>;
}

/** A Super Admin page only a role with `section` (read) may open. */
export function PlatformGate({ section, children }: { section: string; children: ReactNode }) {
  const { me, loading, error, can } = usePlatformMe();
  if (loading && !me) return <StateBlock><Spinner /></StateBlock>;
  if (error && !me) return <StateBlock>{error}</StateBlock>;
  if (!can(section)) {
    const name = me?.sections.find((s) => s.key === section)?.name ?? section;
    return <StateBlock>Your role ({me?.role.name ?? 'none'}) doesn’t include {name}. An Owner can change your role under Team & roles.</StateBlock>;
  }
  return <>{children}</>;
}

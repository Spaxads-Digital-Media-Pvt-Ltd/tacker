/**
 * The signed-in platform staff member (GET /platform/me): their role and what it may do in each section
 * — 'none' (hidden), 'read', 'full' — like Everflow's per-section Full Access / Read Only. Pages hide the
 * actions the role may not take; the sidebar and <PlatformGate> (lib/PlatformMeProvider.tsx) hide what it
 * may not see. The API enforces all of it again.
 */
import { createContext, useContext } from 'react';

export type Level = 'none' | 'read' | 'full';
export interface PlatformMe {
  id: string;
  email: string;
  name: string | null;
  role: { key: string; name: string; scope: 'all' | 'assigned'; home: string };
  permissions: Record<string, Level>;
  sections: { key: string; name: string; description: string }[];
}

export interface PlatformMeCtx {
  me: PlatformMe | null;
  loading: boolean;
  error: string | null;
  can: (section: string, level?: 'read' | 'full') => boolean;
  refetch: () => void;
}
export const PlatformMeContext = createContext<PlatformMeCtx | null>(null);

const RANK: Record<Level, number> = { none: 0, read: 1, full: 2 };
export const grants = (permissions: Record<string, Level> | undefined, section: string, level: 'read' | 'full' = 'read'): boolean =>
  RANK[permissions?.[section] ?? 'none'] >= RANK[level];

/** Outside a Super Admin page there is no platform role: nothing is allowed. */
export function usePlatformMe(): PlatformMeCtx {
  return useContext(PlatformMeContext) ?? { me: null, loading: false, error: null, can: () => false, refetch: () => undefined };
}

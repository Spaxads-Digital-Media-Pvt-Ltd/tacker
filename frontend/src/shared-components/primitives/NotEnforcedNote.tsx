import type { ReactNode } from 'react';

/** Plain, honest callout for settings that are stored but not (yet) acted on by the tracker. */
export function NotEnforcedNote({ children }: { children: ReactNode }) {
  return <p className="mb-4 rounded-card border border-border bg-page px-3 py-2 text-[11px] text-fg-muted">{children}</p>;
}

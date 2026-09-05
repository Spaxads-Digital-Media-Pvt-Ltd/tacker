import { useEffect } from 'react';

/** Locks page scroll for as long as `active` is true (default: for the calling component's whole
 * mounted lifetime — the right default for a modal that's only ever mounted while open). Restores
 * whatever inline `overflow` value was present before, so nested lock/unlock calls (two modals
 * opened in sequence) don't clobber each other. Without this, the page behind an open modal stayed
 * scrollable — no scroll lock existed anywhere in the app. */
export function useLockBodyScroll(active = true): void {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

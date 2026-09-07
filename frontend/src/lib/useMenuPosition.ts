import { useState } from 'react';

export interface MenuPos { top: number; right: number }

/** Computes a `{top,right}` fixed-position anchor for a portaled dropdown/menu below a trigger
 * element, clamped so the panel never renders past the viewport's edges — the app's row-kebab and
 * table-actions menus all use this same `createPortal` + `position:fixed` shape, but previously
 * computed `right: window.innerWidth - r.right` with no clamping, so a menu anchored near a
 * viewport edge (or wider than the remaining space) could render partly or fully off-screen.
 * `width`/`height` are the menu's own footprint (its Tailwind `w-*` in px, and a rough max height)
 * — they don't need to be exact, just enough to keep the panel on-screen. Flips above the trigger
 * when there isn't room below. */
export function useMenuPosition(width = 220, height = 260) {
  const [pos, setPos] = useState<MenuPos>({ top: 0, right: 0 });

  const computeFor = (btn: HTMLElement) => {
    const r = btn.getBoundingClientRect();
    const margin = 8;

    let top = r.bottom + 4;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, r.top - height - 4);

    const rawRight = window.innerWidth - r.right;
    const right = Math.min(Math.max(rawRight, margin), Math.max(margin, window.innerWidth - width - margin));

    setPos({ top, right });
  };

  return { pos, computeFor };
}

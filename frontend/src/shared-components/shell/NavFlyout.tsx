import type React from "react";

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { Icon } from '../primitives/icons';
import type { FlyoutItem, NavEntry } from '../primitives/nav';

/**
 * Index of the flyout item that corresponds to the page currently open, or -1. An item is a
 * candidate when the current path equals its target or sits under it as a child segment (so
 * `/app/offers/123` lights up "Manage" → `/app/offers`, but `/app/offers-templates` does NOT,
 * since the match respects `/` segment boundaries). When several items qualify — e.g.
 * `/app/offers/new` matches both "Manage" (`/app/offers`) and "Add" (`/app/offers/new`) — the
 * most specific wins (longest path, then a matching query string, then an exact hit), so exactly
 * one item is ever marked active. Query strings only matter for the Analytics flyout, whose items
 * differ solely by `?tab=…`.
 */
function activeFlyoutIndex(items: FlyoutItem[], pathname: string, search: string): number {
  let best = -1;
  let bestScore = 0;
  items.forEach((it, i) => {
    if (!it.to) return;
    const q = it.to.indexOf('?');
    const toPath = q === -1 ? it.to : it.to.slice(0, q);
    const toSearch = q === -1 ? '' : it.to.slice(q);
    const onPath = pathname === toPath || pathname.startsWith(`${toPath}/`);
    if (!onPath) return;
    if (toSearch && search !== toSearch) return;
    const score = toPath.length * 2 + toSearch.length + (pathname === toPath ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** Everflow-style rail flyout: click a grouped nav icon, a panel opens beside the rail listing
 * every feature under that section (bold label + a compact one-line description), themed to this
 * app's own design tokens. Always anchored near the top of the rail (not tracking the clicked
 * icon's own position) — matches the reference, which opens every flyout in the same spot
 * regardless of which icon triggered it. A single instance lives in AppShell and its `entry` prop
 * is swapped in place (hover another nav icon while it's open), so the panel never unmounts.
 * Items with a real page navigate; items with none render identically but inert, with a
 * "Not available yet" tooltip — same honesty convention used everywhere else in this app. */
export function NavFlyout({ entry, expanded = false, topOffset, onClose }: {
  entry: NavEntry;
  /** The rail's own expanded state — shifts the panel so it opens just past the rail, not over it. */
  expanded?: boolean;
  topOffset?: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const Ic = Icon[entry.icon];
  const items = entry.flyout ?? [];
  const activeIndex = activeFlyoutIndex(items, pathname, search);

  const flyoutHeight = 60 + items.length * 52 + 16;
  const adjustedTop = topOffset !== undefined
    ? Math.max(12, Math.min(topOffset, typeof window !== 'undefined' ? window.innerHeight - flyoutHeight - 24 : topOffset))
    : 12;

  // Two states that can coexist on *different* items at once:
  //  • hover  — transient accent-subtle wash (unchanged), no bar, default label colour.
  //  • active — the current route: same wash made persistent, PLUS an inset left accent bar and
  //    an accent-coloured label (the same left-bar marker the dark rail's own active item uses).
  // The bar + label colour are what tell the two apart — a hovered non-active item never has
  // them — and when the active item is itself hovered the wash simply doesn't compound, so it
  // still reads as "active, and under the cursor" rather than breaking.
  const itemBase = 'group block w-[calc(100%-16px)] mx-2 my-1 px-3 py-2.5 rounded-lg text-left transition-all duration-200 hover:bg-[rgb(var(--sidebar-accent))]/10 hover:shadow-[0_2px_10px_rgba(45,212,191,0.05)]';
  const activeClass = 'bg-[rgb(var(--sidebar-accent))]/15 shadow-[inset_3px_0_0_rgb(var(--sidebar-accent))]';
  const body = (it: { label: string; description: string; icon?: React.ElementType }, isActive: boolean) => (
    <div className="flex items-start gap-3 w-full">
      {it.icon && <it.icon size={18} className={`mt-0.5 shrink-0 transition-colors duration-200 ${isActive ? 'text-[rgb(var(--sidebar-accent))]' : 'text-[rgb(var(--sidebar-fg-muted))] group-hover:text-[rgb(var(--sidebar-accent))]'}`} />}
      <div className="flex-1">
        <p className={`text-body font-semibold transition-colors duration-200 ${isActive ? 'text-[rgb(var(--sidebar-accent))]' : 'text-[rgb(var(--sidebar-fg-strong))] group-hover:text-white'}`}>{it.label}</p>
        <p className={`mt-0.5 text-tiny transition-colors duration-200 ${isActive ? 'text-[rgb(var(--sidebar-fg))]' : 'text-[rgb(var(--sidebar-fg-muted))] group-hover:text-[rgb(var(--sidebar-fg))]'}`}>{it.description}</p>
      </div>
    </div>
  );

  return createPortal(
    <>
      {/* Backdrop scrim — starts at the rail's right edge so the rail stays interactive (hovering
          another nav icon swaps the flyout in place). The panel floats above it. A black wash
          barely darkens an already-near-black page, so `backdrop-blur-sm` does the separating —
          it reads the same in light and dark; the --flyout-scrim tint just adds a little depth
          (0.20 light / 0.35 dark via the token). */}
      <div
        className={`fixed inset-y-0 right-0 z-40 left-0 bg-[rgb(var(--flyout-scrim))] backdrop-blur-sm ${expanded ? 'md:left-[256px]' : 'md:left-[64px]'}`}
        onClick={onClose}
        aria-hidden
      />
      {/* Below md the rail is a full-width drawer, so anchor the flyout as a near-full-width sheet
          instead of a 256px panel off the rail's edge (which would sit off-screen on a phone). */}
      <div
        ref={ref}
        role="menu"
        style={{ top: adjustedTop, maxHeight: `calc(100vh - ${adjustedTop + 24}px)` }}
        className={`fixed z-50 left-4 right-4 animate-slide-in-right overflow-y-auto scrollbar-slim rounded-card border border-black/80 bg-[rgb(var(--sidebar-bg))]/90 backdrop-blur-xl shadow-[0_8px_20px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(45,212,191,0.2)] md:right-auto md:w-64 ${
          expanded ? 'md:left-[260px]' : 'md:left-[68px]'
        }`}
      >
        <div className="sticky top-0 flex items-center gap-2.5 border-b border-[rgb(var(--sidebar-accent))]/20 bg-transparent px-5 py-4">
          <span className="text-[rgb(var(--sidebar-accent))]"><Ic /></span>
          <h2 className="flex-1 text-h3 font-semibold tracking-tight text-[rgb(var(--sidebar-fg-strong))]">{entry.label}</h2>
          <button onClick={onClose} className="text-[rgb(var(--sidebar-fg))] hover:text-[rgb(var(--sidebar-fg-strong))]" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="py-2">
          {items.map((it, i) => {
            const isActive = i === activeIndex;
            const cls = `${itemBase} ${isActive ? activeClass : ''}`;
            return it.to ? (
              <Link key={it.label} to={it.to} onClick={onClose} className={cls} aria-current={isActive ? 'page' : undefined}>{body(it, isActive)}</Link>
            ) : (
              <button key={it.label} type="button" title="Not available yet" onClick={onClose} className={`w-full ${cls}`}>{body(it, isActive)}</button>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}

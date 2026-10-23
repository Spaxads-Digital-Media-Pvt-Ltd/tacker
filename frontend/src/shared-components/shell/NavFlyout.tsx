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
  //  • hover  — transient sidebar hover wash, no bar, default label colour.
  //  • active — the current route: the rail's own active treatment (teal-tinted fill, hairline
  //    ring, inset left accent bar) and an accent label/icon.
  // The bar + accent label are what tell the two apart — a hovered non-active item never has them.
  const itemBase = 'group block w-[calc(100%-16px)] mx-2 my-1 px-3 py-2.5 rounded-nav text-left transition-colors duration-fast';
  const idleClass = 'hover:bg-sidebar-hover-bg';
  const activeClass = 'sidebar-active ring-1 ring-inset ring-sidebar-ring shadow-[inset_3px_0_0_rgb(var(--sidebar-accent))]';
  const body = (it: { label: string; description: string; icon?: React.ElementType }, isActive: boolean) => (
    <div className="flex items-start gap-3 w-full">
      {it.icon && <it.icon size={18} aria-hidden className={`mt-0.5 shrink-0 transition-colors duration-fast ${isActive ? 'text-sidebar-accent' : 'text-sidebar-fg-muted group-hover:text-sidebar-fg-strong'}`} />}
      <div className="flex-1">
        <p className={`text-body font-semibold transition-colors duration-fast ${isActive ? 'text-sidebar-accent' : 'text-sidebar-fg-strong'}`}>{it.label}</p>
        <p className={`mt-0.5 text-tiny transition-colors duration-fast ${isActive ? 'text-sidebar-fg' : 'text-sidebar-fg-muted group-hover:text-sidebar-fg'}`}>{it.description}</p>
      </div>
    </div>
  );

  return createPortal(
    <>
      {/* Backdrop scrim — starts at the rail's right edge so the rail stays interactive (hovering
          another nav icon swaps the flyout in place). The panel floats above it. */}
      <div
        className={`fixed inset-y-0 right-0 z-40 left-0 bg-[rgb(var(--flyout-scrim))] ${expanded ? 'md:left-[256px]' : 'md:left-[64px]'}`}
        onClick={onClose}
        aria-hidden
      />
      {/* Below md the rail is a full-width drawer, so anchor the flyout as a near-full-width sheet
          instead of a 256px panel off the rail's edge (which would sit off-screen on a phone). */}
      <div
        ref={ref}
        role="menu"
        style={{ top: adjustedTop, maxHeight: `calc(100vh - ${adjustedTop + 24}px)` }}
        className={`fixed z-50 left-4 right-4 animate-slide-in-right motion-reduce:animate-none overflow-y-auto scrollbar-slim rounded-card border border-sidebar-border bg-sidebar shadow-elevated md:right-auto md:w-64 ${
          expanded ? 'md:left-[260px]' : 'md:left-[68px]'
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-sidebar-border bg-sidebar px-5 py-4">
          <span className="text-sidebar-accent" aria-hidden><Ic /></span>
          <h2 className="flex-1 text-h3 font-semibold tracking-tight text-sidebar-fg-strong">{entry.label}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-sidebar-fg transition-colors duration-fast hover:bg-sidebar-hover-bg hover:text-sidebar-fg-strong" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="py-2">
          {items.map((it, i) => {
            const isActive = i === activeIndex;
            const cls = `${itemBase} ${isActive ? activeClass : idleClass}`;
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

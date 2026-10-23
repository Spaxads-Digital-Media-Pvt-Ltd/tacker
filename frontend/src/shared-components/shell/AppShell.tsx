import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, ChevronRight, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { type Role } from '../../auth/roles';
import { NAV, type NavEntry } from '../primitives/nav';
import { Icon } from '../primitives/icons';
import { Brandmark } from '../primitives/Brandmark';
import { PageTitleProvider, usePageTitleValue } from '../primitives/PageTitle';
import { ProfileMenu } from './ProfileMenu';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { NotificationsBell, AccountLink, HelpMenu } from './SidebarUtilityMenu';
import { SectionTabs } from './SectionTabs';
import { NavFlyout } from './NavFlyout';
import { SearchModal } from './SearchModal';
import { PlatformSearchModal } from './PlatformSearchModal';
import { ImpersonationBanner } from './ImpersonationBanner';
import { OverdueInvoiceBanner } from './OverdueInvoiceBanner';
import { AnnouncementBanner } from './AnnouncementBanner';
import { useNetworkBranding } from '../../lib/useNetworkBranding';
import { usePlatformMe } from '../../lib/platformMe';

/** Drop what `can` doesn't allow; a flyout left empty goes too. */
function permittedNav(entries: NavEntry[], can: (section: string) => boolean): NavEntry[] {
  return entries.flatMap((e) => {
    if (e.perm && !can(e.perm)) return [];
    if (!e.flyout) return [e];
    const flyout = e.flyout.filter((f) => !f.perm || can(f.perm));
    return flyout.length ? [{ ...e, flyout }] : [];
  });
}

/** Network staff: drop what the platform turned off for the network (a flag answered false; no flag = on). */
function featuredNav(entries: NavEntry[], features: Record<string, boolean>): NavEntry[] {
  return entries.flatMap((e) => {
    if (e.feature && features[e.feature] === false) return [];
    if (!e.flyout) return [e];
    const flyout = e.flyout.filter((f) => !f.feature || features[f.feature] !== false);
    return flyout.length ? [{ ...e, flyout }] : [];
  });
}

/** Flatten a role's nav (groups + leaves) to {to,label} pairs for route→title resolution. */
function flattenNav(role: Role): { to: string; label: string }[] {
  const out: { to: string; label: string }[] = [];
  for (const e of NAV[role] ?? []) {
    if (e.to) out.push({ to: e.to, label: e.label });
    for (const c of e.children ?? []) out.push({ to: c.to, label: c.label });
  }
  return out;
}

/** Derive a page title from the current path: exact nav match, else longest-prefix section. */
function routeTitle(pathname: string, role: Role): string {
  const items = flattenNav(role);
  let best = '';
  let label = '';
  for (const { to, label: l } of items) {
    if (pathname === to) return l;
    if (pathname.startsWith(to + '/') && to.length > best.length) { best = to; label = l; }
  }
  if (pathname.endsWith('/profile')) return 'My profile';
  return label || 'Dashboard';
}

/** Who gets global search: network staff (SearchModal) and the Super Admin console
 * (PlatformSearchModal). The publisher / advertiser portals have no search — no button, no ⌘K. */
function hasSearch(role: Role): boolean {
  return role === 'admin' || role === 'super_admin';
}

/** Rail labels fade in after the width animation (--dur-slow); none under reduced motion. */
const LABEL_FADE = 'animate-fade-in [animation-delay:var(--dur-slow)] motion-reduce:animate-none';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Slim top header — page title on the left, search (staff / Super Admin only) + theme + profile
 * on the right. Below `md` the persistent rail is a hidden drawer, so the header also carries the
 * menu trigger + brand mark. */
function TopHeader({ role, initials, displayName, email, logoUrl, onSignOut, onMenu, onSearch }: {
  role: Role; initials: string; displayName: string; email: string; logoUrl: string | null; onSignOut: () => void; onMenu: () => void; onSearch: () => void;
}) {
  const loc = useLocation();
  const { title, subtitle } = usePageTitleValue();
  const heading = title ?? routeTitle(loc.pathname, role);
  const search = hasSearch(role);
  return (
    <header className="relative z-40 flex items-center gap-2 border-b border-border bg-header px-4 py-2.5 text-header-fg sm:gap-3 sm:px-6 lg:px-8">
      {/* Left zone — nav trigger + brand (both < md only) + page title. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="-ml-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg-secondary transition-colors duration-fast hover:bg-subtle hover:text-header-fg md:hidden"
        >
          <Menu size={20} />
        </button>
        {/* Brand chip: skip on the smallest screens so the page title fits; the hamburger already
            carries the nav affordance there. */}
        <div className="hidden shrink-0 sm:block md:hidden"><Brandmark compact logoUrl={logoUrl} /></div>
        <div className="min-w-0">
          <h1 className="truncate text-h3 font-semibold leading-tight text-header-fg sm:text-h2">{heading}</h1>
          {subtitle && <p className="truncate text-tiny text-fg-muted">{subtitle}</p>}
        </div>
      </div>

      {/* Right zone — search, theme toggle, profile. */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {search && (
          <>
            {/* Desktop search */}
            <button
              type="button" onClick={onSearch}
              className="group hidden w-60 items-center gap-2 rounded-full border border-border bg-subtle px-3.5 py-2 text-small text-fg-muted transition-colors duration-fast hover:border-border-hover hover:bg-surface md:flex"
            >
              <Search size={15} className="shrink-0" aria-hidden />
              <span className="flex-1 text-left font-medium">Search…</span>
              <kbd className="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-tiny font-semibold text-fg-muted">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
            </button>

            {/* Mobile search */}
            <button
              type="button" onClick={onSearch} aria-label="Search"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-subtle text-header-fg transition-colors duration-fast hover:border-border-hover hover:bg-surface md:hidden"
            >
              <Search size={18} aria-hidden />
            </button>
          </>
        )}

        <ThemeToggle />
        <ProfileMenu role={role} initials={initials} displayName={displayName} email={email} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

/** Hover / focus tooltip for the collapsed rail. Portaled + fixed-positioned, so the nav's own
 * scroll container can't clip it. Hidden while a flyout is open (the flyout names the section). */
function useRailTip(label: string, enabled: boolean) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const show = (e: SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hide = () => setPos(null);
  const tip = enabled && pos
    ? createPortal(
        <span
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
          className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] bg-fg px-2 py-1 text-tiny font-medium text-page shadow-elevated"
        >
          {label}
        </span>,
        document.body,
      )
    : null;
  return { tip, handlers: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide } };
}

/** True if `to` (a leaf's own route) should be considered the current page. */
function isLeafActive(to: string, pathname: string): boolean {
  const end = to.split('/').length <= 2;
  return end ? pathname === to : pathname === to || pathname.startsWith(to + '/');
}

/** True if any child (or flyout item) of a group route matches the current page. */
function isGroupActive(entry: NavEntry, pathname: string): boolean {
  const targets = [...(entry.children ?? []), ...(entry.flyout ?? [])];
  return targets.some((c) => c.to && (pathname === c.to || pathname.startsWith(c.to + '/')));
}

/** A rail item that opens an Everflow-style flyout instead of navigating directly, when the entry
 * has one. Renders as an icon-only button with a tooltip (collapsed rail) or an icon+label row
 * (expanded rail). The accent tint only shows for the active/open item. */
function RailItem({ entry, pathname, expanded, fadeLabels, openLabel, onToggle, onSwap }: {
  entry: NavEntry; pathname: string; expanded: boolean; fadeLabels: boolean; openLabel: string | null;
  onToggle: (label: string, top: number) => void;
  /** Hover-swap: mouse-enter a different flyout icon while one is already open → switch to it. */
  onSwap: (label: string | null, top: number) => void;
}) {
  const Ic = Icon[entry.icon];
  const btnRef = useRef<HTMLButtonElement>(null);
  const active = entry.to ? isLeafActive(entry.to, pathname) : isGroupActive(entry, pathname);
  const isOpen = openLabel === entry.label;

  // "Lit" row. Normally that's the route-active row. But while *a* flyout is open, only the row
  // whose flyout is open lights up — otherwise the route-active row (a different section) would
  // glow at the same time and read as a double-highlight bug.
  const on = openLabel === null ? active : isOpen;

  // Idle: secondary text, hover wash. On: teal-tinted fill, strong text, accent icon, a hairline
  // ring and (expanded) a left indicator bar. Same tokens in both themes.
  const railIdle = 'text-sidebar-fg hover:bg-sidebar-hover-bg hover:text-sidebar-fg-strong';
  const railOn = 'sidebar-active text-sidebar-fg-strong ring-1 ring-inset ring-sidebar-ring';
  const rowClass = expanded
    ? `relative flex w-full items-center gap-3 rounded-nav px-3 py-2.5 text-small font-medium transition-colors duration-fast ${on ? railOn : railIdle}`
    : `grid h-11 w-11 place-items-center rounded-nav transition-colors duration-fast ${on ? railOn : railIdle}`;

  const { tip, handlers: tipHandlers } = useRailTip(entry.label, !expanded && openLabel === null);
  // Labels fade in once the rail has finished widening (only when the user toggled it).
  const labelCls = fadeLabels ? LABEL_FADE : '';

  const content = expanded ? (
    <>
      {on && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-accent" />}
      <Ic className={`shrink-0 ${on ? 'text-sidebar-accent' : ''}`} />
      {/* text-left: flyout rows are <button>s (default text-align:center) — keep labels flush */}
      <span className={`flex-1 truncate text-left ${labelCls}`}>{entry.label}</span>
      {entry.flyout && <ChevronRight size={14} aria-hidden className={`shrink-0 ${on ? 'text-sidebar-accent' : 'text-sidebar-fg-muted'}`} />}
    </>
  ) : (
    <Ic className={on ? 'text-sidebar-accent' : ''} />
  );

  if (entry.flyout) {
    return (
      <div className={expanded ? 'w-full px-2' : 'w-full flex justify-center'}>
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => onToggle(entry.label, btnRef.current?.getBoundingClientRect().top ?? 12)}
          onPointerEnter={(e) => {
            // Hover opens the flyout instantly
            if (e.pointerType === 'mouse') onSwap(entry.label, btnRef.current?.getBoundingClientRect().top ?? 12);
          }}
          aria-label={expanded ? undefined : entry.label}
          {...tipHandlers}
          className={`group relative ${rowClass}`}
        >
          {content}
        </button>
        {tip}
      </div>
    );
  }

  return (
    <div className={expanded ? 'w-full px-2' : 'w-full flex justify-center'}>
      <Link
        to={entry.to ?? '#'}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') onSwap(null, 12);
        }}
        aria-label={expanded ? undefined : entry.label}
        aria-current={active ? 'page' : undefined}
        {...tipHandlers}
        className={`group relative ${rowClass}`}
      >
        {content}
      </Link>
      {tip}
    </div>
  );
}

const NAV_EXPANDED_KEY = 'tracker-nav-expanded';

/** The rail's saved expanded/collapsed choice; with none saved, expanded on wide screens (≥ 1280px). */
function readNavExpanded(): boolean {
  try {
    const v = localStorage.getItem(NAV_EXPANDED_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* storage unavailable — fall through to the width default */
  }
  try {
    return window.matchMedia('(min-width: 1280px)').matches;
  } catch {
    return false;
  }
}

/** Collapsible rail: icons only, or a labeled, grouped rail — Everflow-style — toggled from the
 * brand mark at the top. The choice is remembered (tracker-nav-expanded). */
export function AppShell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(12);
  const [expanded, setExpanded] = useState(readNavExpanded);
  // Set once the user toggles the rail, so labels fade in after the width animation — not on first paint.
  const [fadeLabels, setFadeLabels] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // O12: the network's logo / favicon (staff and portals; the Super Admin console has no network).
  const { logoUrl, overdueInvoice, features, announcements } = useNetworkBranding(Boolean(session) && session?.role !== 'super_admin');
  const platform = usePlatformMe();
  const searchEnabled = session ? hasSearch(session.role) : false;

  const toggleExpanded = () => {
    const next = !expanded;
    setFadeLabels(true);
    setExpanded(next);
    try {
      localStorage.setItem(NAV_EXPANDED_KEY, String(next));
    } catch {
      /* private mode / storage disabled — the choice still holds for this session */
    }
  };

  // ⌘K / Ctrl+K opens the search — only for roles that have one (not the publisher / advertiser portals).
  useEffect(() => {
    if (!searchEnabled) return;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchEnabled]);

  // Off-canvas drawer (< md): close on navigation and on Escape.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    // At md+ the rail is persistent, not a drawer — drop any stuck drawer state on resize up.
    const mq = window.matchMedia('(min-width: 768px)');
    const onMq = () => { if (mq.matches) setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    return () => { window.removeEventListener('keydown', onKey); mq.removeEventListener('change', onMq); };
  }, [mobileOpen]);

  if (!session) return null;

  // Super Admin: only what the member's role may read (an item's / flyout item's `perm`).
  const items = session.role === 'super_admin' ? permittedNav(NAV.super_admin, platform.can) : featuredNav(NAV[session.role], features);
  const initials = session.displayName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  const toggleProps = {
    openLabel: openFlyout,
    onToggle: (label: string, top: number) => {
      setOpenFlyout((cur) => (cur === label ? null : label));
      setFlyoutTop(top);
    },
    onSwap: (label: string | null, top: number) => {
      setOpenFlyout(label);
      setFlyoutTop(top);
    },
  };
  // One persistent flyout instance (was one per rail item) so hover-swapping between sections
  // changes content in place instead of unmount/remount — no re-animation, no scrim flash.
  const openEntry = items.find((i) => i.label === openFlyout) ?? null;
  // The drawer (< lg, when open) is always full-width + labelled; the desktop rail follows `expanded`.
  const labeled = expanded || mobileOpen;
  const headerFade = fadeLabels && !mobileOpen ? LABEL_FADE : '';

  let lastGroup: string | undefined;

  return (
    <PageTitleProvider>
    <div className="flex h-full">
      {/* Off-canvas backdrop (< md only) — the same flat scrim token as NavFlyout (no frosted glass). */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[rgb(var(--flyout-scrim))] md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <aside
        onMouseLeave={() => setOpenFlyout(null)}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-x-hidden border-r border-sidebar-border bg-sidebar pb-6 pt-4 text-sidebar-fg shadow-elevated transition-transform duration-base ease-out-token motion-reduce:transition-none md:static md:z-auto md:translate-x-0 md:shadow-none md:transition-[width] md:duration-slow ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${expanded ? 'md:w-64' : 'md:w-16 md:items-center'}`}
      >
        {/* Brand area — logo always sits at the very top of the rail. Expanded/drawer: logo +
         * wordmark in a row with the close button. Collapsed: just the mark. The mark toggles the rail. */}
        <div className={labeled ? 'mb-3 flex items-center gap-2 px-3.5' : 'mb-3 flex flex-col items-center gap-1'}>
          <button
            type="button"
            onClick={toggleExpanded}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={expanded}
            className={`rounded-nav text-left text-sidebar-fg-strong ${labeled ? 'min-w-0 flex-1' : 'grid h-11 w-11 place-items-center'}`}
          >
            <Brandmark compact={!labeled} logoUrl={logoUrl} />
          </button>
          {/* mobile: close the drawer */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sidebar-fg transition-colors duration-fast hover:bg-sidebar-hover-bg hover:text-sidebar-fg-strong md:hidden"
          >
            <X size={18} />
          </button>
        </div>
        {labeled && (
          <p className={`mb-1.5 mt-1 px-5 text-tiny font-semibold uppercase tracking-wider text-sidebar-fg-muted ${headerFade}`}>Core Platform</p>
        )}

        <nav aria-label="Main" className="scrollbar-slim flex w-full flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            const showHeader = labeled && item.group && item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.label} className={labeled ? 'w-full' : 'contents'}>
                {showHeader && (
                  <p className={`mb-1.5 mt-4 px-5 text-tiny font-semibold uppercase tracking-wider text-sidebar-fg-muted first:mt-0 ${headerFade}`}>{item.group}</p>
                )}
                <RailItem entry={item} pathname={location.pathname} expanded={labeled} fadeLabels={fadeLabels && !mobileOpen} {...toggleProps} />
              </div>
            );
          })}
        </nav>

        {openEntry && <NavFlyout entry={openEntry} expanded={labeled} topOffset={flyoutTop} onClose={() => setOpenFlyout(null)} />}

        <div className={labeled ? 'w-full space-y-1 border-t border-sidebar-border px-2 pt-3' : 'flex flex-col items-center gap-0.5 border-t border-sidebar-border pt-2'}>
          {/* N1: the bell is network staff's (their audit feed + notification preferences); partner /
              advertiser portals and the Super Admin console have neither, so they don't show it. */}
          {session.role === 'admin' && <NotificationsBell expanded={labeled} />}
          <HelpMenu expanded={labeled} />
          {/* Account → /app/profile exists only on the network-staff surface; the portals and the
              Super Admin console have no profile page, so they don't show it. */}
          {session.role === 'admin' && <AccountLink expanded={labeled} />}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col bg-page">
        {session.impersonatedBy && <ImpersonationBanner session={session} />}
        {session.role === 'admin' && overdueInvoice && <OverdueInvoiceBanner invoice={overdueInvoice} />}
        {session.role !== 'super_admin' && <AnnouncementBanner announcements={announcements} />}
        <TopHeader role={session.role} initials={initials} displayName={session.displayName}
          email={session.email} logoUrl={logoUrl} onSignOut={async () => {
            // Signing out of an impersonation tab only ends the impersonation (see auth/session.ts).
            const impersonating = Boolean(session.impersonatedBy);
            await signOut();
            navigate(impersonating ? '/impersonate?ended=1' : '/login');
          }}
          onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} />
        <main className="flex-1 overflow-auto px-4 pb-12 pt-5 sm:px-6 lg:px-8">
          <div className="w-full animate-fade-in">
            <SectionTabs role={session.role} />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    {searchOpen && searchEnabled && (session.role === 'super_admin'
      ? <PlatformSearchModal onClose={() => setSearchOpen(false)} />
      : <SearchModal onClose={() => setSearchOpen(false)} />)}
    </PageTitleProvider>
  );
}

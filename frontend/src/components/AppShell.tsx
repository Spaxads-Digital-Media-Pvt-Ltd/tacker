import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, ChevronRight, ChevronsLeft, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME, type Role } from '../auth/roles';
import { NAV, type NavEntry } from './nav';
import { Icon } from './icons';
import { Brandmark } from './Brandmark';
import { PageTitleProvider, usePageTitleValue } from './PageTitle';
import { ProfileMenu } from './ProfileMenu';
import { ThemeToggle } from '../theme/ThemeToggle';
import { NotificationsBell, AccountLink, HelpMenu } from './SidebarUtilityMenu';
import { SectionTabs } from './SectionTabs';
import { NavFlyout } from './NavFlyout';
import { SearchModal } from './SearchModal';

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

/** Slim top header (Section 1) — page title on the left (Section 2), global search + profile menu
 * on the right. Below `md` the persistent rail is a hidden drawer, so the header also carries the
 * menu trigger + brand mark. Search opens the global SearchModal (⌘K is a visual affordance only —
 * no keyboard handler is wired anywhere in the app today). */
function TopHeader({ role, initials, displayName, email, onSignOut, onMenu, onSearch }: {
  role: Role; initials: string; displayName: string; email: string; onSignOut: () => void; onMenu: () => void; onSearch: () => void;
}) {
  const loc = useLocation();
  const { title, subtitle } = usePageTitleValue();
  const heading = title ?? routeTitle(loc.pathname, role);
  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
      {/* Left zone — nav trigger + brand (both < md only) + page title. flex-1 so it balances
          the right zone and keeps the centre search bar actually centred. */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg md:hidden"
        >
          <Menu size={18} />
        </button>
        {/* Brand chip: skip on the smallest screens so the page title + header search fit; the
            hamburger already carries the nav affordance there. */}
        <div className="hidden shrink-0 sm:block md:hidden"><Brandmark compact /></div>
        <div className="min-w-0">
          <h1 className="truncate text-h2 font-semibold leading-tight text-fg">{heading}</h1>
          {subtitle && <p className="truncate text-tiny text-fg-secondary">{subtitle}</p>}
        </div>
      </div>

      {/* Centre zone — the search pill, centred from md up (persistent rail, no hamburger).
          Below md it drops out and the compact icon in the right zone takes over. */}
      <div className="hidden flex-1 justify-center md:flex">
        <button
          type="button" onClick={onSearch}
          className="flex w-full max-w-xs items-center gap-2 rounded-[var(--radius)] border border-border bg-page px-3 py-1.5 text-small text-fg-muted transition-colors hover:border-fg-muted hover:text-fg-secondary"
        >
          <Search size={15} className="shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">⌘K</kbd>
        </button>
      </div>

      {/* Right zone — flex-1 + justify-end so it mirrors the left zone's width. */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <button
          type="button" onClick={onSearch} aria-label="Search"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg md:hidden"
        >
          <Search size={18} />
        </button>
        <ThemeToggle />
        <ProfileMenu initials={initials} displayName={displayName} email={email} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

/** Tooltip label that appears to the right of an icon on hover/focus (collapsed rail only). */
function RailTip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-tiny font-medium text-page opacity-0 shadow-elevated transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  );
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
 * has one. Renders as an icon-only button (collapsed rail) or icon+label row (expanded rail). Icon
 * color is dark/near-black by default (not muted gray) so the collapsed rail reads clearly, same
 * as the reference — the accent tint only shows for the active/open item. */
function RailItem({ entry, pathname, expanded, openLabel, onToggle, onSwap }: {
  entry: NavEntry; pathname: string; expanded: boolean; openLabel: string | null;
  onToggle: (label: string) => void;
  /** Hover-swap: mouse-enter a different flyout icon while one is already open → switch to it. */
  onSwap: (label: string) => void;
}) {
  const Ic = Icon[entry.icon];
  const btnRef = useRef<HTMLButtonElement>(null);
  const active = entry.to ? isLeafActive(entry.to, pathname) : isGroupActive(entry, pathname);
  const isOpen = openLabel === entry.label;

  // "Lit" row. Normally that's the route-active row. But while *a* flyout is open, only the row
  // whose flyout is open lights up — otherwise the route-active row (a different section) would
  // glow at the same time and read as a double-highlight bug.
  const on = openLabel === null ? active : isOpen;

  // Expanded rail gets the premium treatment (accent-gradient active row, dimmer idle text,
  // gradient icon chip on the active item, trailing chevron for flyout groups). The collapsed
  // icon rail is left exactly as-is for responsive parity.
  const railIdle = 'text-[rgb(var(--sidebar-fg))] hover:bg-[rgb(var(--sidebar-hover-bg))] hover:text-[rgb(var(--sidebar-fg-strong))]';
  const rowClass = expanded
    ? `relative flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-small font-medium transition-colors ${
        on ? 'sidebar-active' : railIdle
      }`
    : `grid h-11 w-11 place-items-center rounded-[var(--radius)] transition-colors ${
        on ? 'bg-[rgb(var(--sidebar-active-bg))] text-[rgb(var(--sidebar-accent))]' : railIdle
      }`;

  const iconEl = expanded && on
    ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius)] bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-sm"><Ic /></span>
    : <Ic />;

  const content = expanded ? (
    <>
      {iconEl}
      {/* text-left: flyout rows are <button>s (default text-align:center) — keep labels flush */}
      <span className="flex-1 truncate text-left">{entry.label}</span>
      {entry.flyout && <ChevronRight size={14} className={`shrink-0 ${on ? 'text-[rgb(var(--sidebar-accent))]' : 'text-[rgb(var(--sidebar-fg-muted))]'}`} />}
    </>
  ) : (
    <>
      <Ic />
      <RailTip>{entry.label}</RailTip>
    </>
  );

  if (entry.flyout) {
    return (
      <div className={expanded ? 'w-full px-2' : ''}>
        <button
          ref={btnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => onToggle(entry.label)}
          onPointerEnter={(e) => {
            // Hover another flyout icon while one is open → swap instantly. Mouse only, so touch
            // keeps pure tap-to-open (no hover on touch); doesn't open a flyout from nothing.
            if (e.pointerType === 'mouse' && openLabel && openLabel !== entry.label) onSwap(entry.label);
          }}
          className={`group relative ${rowClass}`}
        >
          {content}
        </button>
      </div>
    );
  }

  return (
    <div className={expanded ? 'w-full px-2' : ''}>
      <Link to={entry.to ?? '#'} className={`group relative ${rowClass}`}>
        {content}
      </Link>
    </div>
  );
}

/** Icon-only by default (Section 3); toggles to a labeled, grouped rail — Everflow-style — via the
 * hamburger button at the top. */
export function AppShell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

  const items = NAV[session.role];
  const initials = session.displayName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  const toggleProps = {
    openLabel: openFlyout,
    onToggle: (label: string) => setOpenFlyout((cur) => (cur === label ? null : label)),
    onSwap: (label: string) => setOpenFlyout(label),
  };
  // One persistent flyout instance (was one per rail item) so hover-swapping between sections
  // changes content in place instead of unmount/remount — no re-animation, no scrim flash.
  const openEntry = items.find((i) => i.label === openFlyout) ?? null;
  // The drawer (< lg, when open) is always full-width + labelled; the desktop rail follows `expanded`.
  const labeled = expanded || mobileOpen;

  let lastGroup: string | undefined;

  return (
    <PageTitleProvider>
    <div className="flex h-full">
      {/* Off-canvas backdrop (< md only) — same scrim token + blur as NavFlyout. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[rgb(var(--flyout-scrim))] backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`flex flex-col border-r border-border bg-[rgb(var(--sidebar-bg))] text-[rgb(var(--sidebar-fg))] pt-4 pb-6 fixed inset-y-0 left-0 z-50 w-72 transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${expanded ? 'md:w-64' : 'md:w-16 md:items-center'}`}
      >
        {/* Brand area — logo always sits at the very top of the rail. Expanded/drawer: logo +
         * wordmark in a row with the toggle. Collapsed: just the mark, stacked above the toggle. */}
        <div className={labeled ? 'mb-3 flex items-center gap-2 px-3.5' : 'mb-3 flex flex-col items-center gap-1'}>
          <Link
            to={ROLE_HOME[session.role]}
            aria-label="Home"
            className={`text-[rgb(var(--sidebar-fg-strong))] ${labeled ? 'min-w-0 flex-1' : 'grid h-11 w-11 place-items-center'}`}
          >
            <Brandmark compact={!labeled} />
          </Link>
          {/* desktop: collapse / expand the rail */}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-[rgb(var(--sidebar-fg))] transition-colors hover:bg-[rgb(var(--sidebar-hover-bg))] hover:text-[rgb(var(--sidebar-fg-strong))] md:grid"
          >
            {expanded ? <ChevronsLeft size={18} /> : <Menu size={18} />}
          </button>
          {/* mobile: close the drawer */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-[rgb(var(--sidebar-fg))] transition-colors hover:bg-[rgb(var(--sidebar-hover-bg))] hover:text-[rgb(var(--sidebar-fg-strong))] md:hidden"
          >
            <X size={18} />
          </button>
        </div>
        {labeled && (
          <p className="mb-1.5 mt-1 px-5 text-tiny font-semibold uppercase tracking-wider text-[rgb(var(--sidebar-fg-muted))]">Core Platform</p>
        )}

        <nav className={`scrollbar-slim flex flex-1 flex-col overflow-y-auto ${labeled ? 'w-full gap-1' : 'items-center gap-1'}`}>
          {items.map((item) => {
            const showHeader = labeled && item.group && item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.label} className={labeled ? 'w-full' : 'contents'}>
                {showHeader && (
                  <p className="mb-1.5 mt-4 px-5 text-tiny font-semibold uppercase tracking-wider text-[rgb(var(--sidebar-fg-muted))] first:mt-0">{item.group}</p>
                )}
                <RailItem entry={item} pathname={location.pathname} expanded={labeled} {...toggleProps} />
              </div>
            );
          })}
        </nav>

        {openEntry && <NavFlyout entry={openEntry} expanded={labeled} onClose={() => setOpenFlyout(null)} />}

        <div className={labeled ? 'w-full space-y-1 border-t border-[rgb(var(--sidebar-border))] px-2 pt-3' : 'flex flex-col items-center gap-0.5 border-t border-[rgb(var(--sidebar-border))] pt-2'}>
          <NotificationsBell expanded={labeled} />
          <HelpMenu expanded={labeled} />
          <AccountLink expanded={labeled} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col bg-page">
        <TopHeader role={session.role} initials={initials} displayName={session.displayName}
          email={session.email} onSignOut={async () => { await signOut(); navigate('/login'); }}
          onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} />
        <main className="flex-1 overflow-auto p-4">
          <div className="w-full animate-fade-in">
            <SectionTabs role={session.role} />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </PageTitleProvider>
  );
}

import { useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME, type Role } from '../auth/roles';
import { NAV, type NavEntry } from './nav';
import { Icon } from './icons';
import { Brandmark } from './Brandmark';
import { PageTitleProvider, usePageTitleValue } from './PageTitle';
import { ProfileMenu } from './ProfileMenu';
import { NotificationsBell, ProfileRailMenu, HelpMenu } from './SidebarUtilityMenu';
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

/** Slim top header (Section 1) — page title on the left (Section 2), profile menu on the right. */
function TopHeader({ role, initials, displayName, email, onSignOut }: {
  role: Role; initials: string; displayName: string; email: string; onSignOut: () => void;
}) {
  const loc = useLocation();
  const { title, subtitle } = usePageTitleValue();
  const heading = title ?? routeTitle(loc.pathname, role);
  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="md:hidden"><Brandmark compact /></div>
        <div className="min-w-0">
          <h1 className="truncate text-h2 font-semibold leading-tight text-fg">{heading}</h1>
          {subtitle && <p className="truncate text-tiny text-fg-secondary">{subtitle}</p>}
        </div>
      </div>
      <ProfileMenu initials={initials} displayName={displayName} email={email} onSignOut={onSignOut} />
    </header>
  );
}

/** Tooltip label that appears to the right of an icon on hover/focus (collapsed rail only). */
function RailTip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-tiny font-medium text-white opacity-0 shadow-elevated transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
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
function RailItem({ entry, pathname, expanded, openLabel, onToggle, onClose }: {
  entry: NavEntry; pathname: string; expanded: boolean; openLabel: string | null;
  onToggle: (label: string) => void; onClose: () => void;
}) {
  const Ic = Icon[entry.icon];
  const btnRef = useRef<HTMLButtonElement>(null);
  const active = entry.to ? isLeafActive(entry.to, pathname) : isGroupActive(entry, pathname);
  const isOpen = openLabel === entry.label;

  const rowClass = expanded
    ? `flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium transition-colors ${
        active || isOpen ? 'bg-accent-subtle text-accent-text' : 'text-fg hover:bg-accent-subtle hover:text-fg'
      }`
    : `grid h-11 w-11 place-items-center rounded-[var(--radius)] transition-colors ${
        active || isOpen ? 'bg-accent-subtle text-accent-text' : 'text-fg hover:bg-accent-subtle hover:text-fg'
      }`;

  const content = (
    <>
      <Ic />
      {expanded ? <span className="truncate">{entry.label}</span> : <RailTip>{entry.label}</RailTip>}
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
          className={`group relative ${rowClass}`}
        >
          {content}
        </button>
        {isOpen && <NavFlyout entry={entry} onClose={onClose} />}
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
  const [searchOpen, setSearchOpen] = useState(false);
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
    onClose: () => setOpenFlyout(null),
  };

  let lastGroup: string | undefined;

  return (
    <PageTitleProvider>
    <div className="flex h-full">
      <aside className={`hidden flex-col border-r border-border bg-surface py-3 md:flex ${expanded ? 'w-60' : 'w-16 items-center'}`}>
        <div className={`mb-1 flex items-center gap-2 ${expanded ? 'px-3' : ''}`}>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg"
          >
            <Menu size={18} />
          </button>
          {expanded && (
            <Link to={ROLE_HOME[session.role]} className="flex-1">
              <Brandmark />
            </Link>
          )}
        </div>
        {expanded ? (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mb-1 flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg mx-3"
          >
            <Search size={18} />Search
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="group relative mb-1 grid h-9 w-9 place-items-center rounded-[var(--radius)] text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg"
          >
            <Search size={18} />
            <RailTip>Search</RailTip>
          </button>
        )}
        {!expanded && (
          <Link to={ROLE_HOME[session.role]} className="mb-2 grid h-11 w-11 place-items-center">
            <Brandmark compact />
          </Link>
        )}
        {expanded && (
          <div className="my-2 flex items-center gap-2 px-3 text-tiny font-semibold uppercase tracking-wide text-fg-muted">
            <span className="h-px flex-1 bg-border" />Core Platform<span className="h-px flex-1 bg-border" />
          </div>
        )}

        <nav className={`flex flex-1 flex-col overflow-y-auto ${expanded ? 'w-full gap-0.5' : 'items-center gap-1'}`}>
          {items.map((item) => {
            const showHeader = expanded && item.group && item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.label} className={expanded ? 'w-full' : 'contents'}>
                {showHeader && (
                  <p className="mb-1 mt-3 px-5 text-tiny font-semibold uppercase tracking-wide text-fg-muted first:mt-0">{item.group}</p>
                )}
                <RailItem entry={item} pathname={location.pathname} expanded={expanded} {...toggleProps} />
              </div>
            );
          })}
        </nav>

        <div className={expanded ? 'w-full space-y-0.5 border-t border-border px-2 pt-2' : 'flex flex-col items-center gap-0.5 border-t border-border pt-2'}>
          <NotificationsBell expanded={expanded} />
          <ProfileRailMenu expanded={expanded} initials={initials} displayName={session.displayName} email={session.email}
            onSignOut={async () => { await signOut(); navigate('/login'); }} />
          <HelpMenu expanded={expanded} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col bg-page">
        <TopHeader role={session.role} initials={initials} displayName={session.displayName}
          email={session.email} onSignOut={async () => { await signOut(); navigate('/login'); }} />
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

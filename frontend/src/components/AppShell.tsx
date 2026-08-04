import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, type Role } from '../auth/roles';
import { NAV, type NavEntry } from './nav';
import { Icon } from './icons';
import { Brandmark } from './Brandmark';
import { PageTitleProvider, usePageTitleValue } from './PageTitle';
import { ProfileMenu } from './ProfileMenu';

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
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/80 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="md:hidden"><Brandmark compact /></div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-h3 font-semibold leading-tight text-fg">{heading}</h1>
          {subtitle && <p className="truncate text-tiny text-fg-secondary">{subtitle}</p>}
        </div>
      </div>
      <ProfileMenu initials={initials} displayName={displayName} email={email} onSignOut={onSignOut} />
    </header>
  );
}

// Sidebar nav rows (Section 3): a left accent bar marks the active row instead of a filled pill —
// reads calmer across a long, densely-grouped nav than a solid highlight block.
const leafClass = (isActive: boolean) =>
  `group flex items-center gap-3 rounded-r-[var(--radius)] border-l-2 py-2 pl-3 pr-3 text-small font-medium transition-colors ${
    isActive ? 'border-accent bg-accent-subtle text-accent-text' : 'border-transparent text-fg-secondary hover:border-border hover:bg-subtle hover:text-fg'
  }`;

function NavGroup({ entry }: { entry: NavEntry }) {
  const loc = useLocation();
  const childActive = (entry.children ?? []).some((c) => loc.pathname === c.to || loc.pathname.startsWith(c.to + '/'));
  const [open, setOpen] = useState(childActive);
  const Ic = Icon[entry.icon];
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium transition-colors ${childActive ? 'text-fg' : 'text-fg-secondary hover:bg-subtle hover:text-fg'}`}
      >
        <Ic width={17} height={17} /> <span className="flex-1 text-left">{entry.label}</span>
        <span className={`text-tiny text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="mb-1 ml-[1.15rem] space-y-0.5 border-l border-border pl-2">
          {(entry.children ?? []).map((c) => (
            <NavLink key={c.to} to={c.to} end
              className={({ isActive }) => `block rounded-[var(--radius)] px-3 py-1.5 text-small transition-colors ${isActive ? 'bg-accent-subtle font-medium text-accent-text' : 'text-fg-secondary hover:bg-subtle hover:text-fg'}`}>
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared app shell: sidebar (role nav) + topbar + routed content. */
export function AppShell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  if (!session) return null;

  const items = NAV[session.role];
  const initials = session.displayName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  return (
    <PageTitleProvider>
    <div className="flex h-full">
      {/* Sidebar — warm paper tint, distinct from the white content surface (Section 3) */}
      <aside className="hidden w-64 flex-col border-r border-border bg-subtle/60 md:flex">
        <div className="border-b border-border px-4 py-4">
          <Brandmark />
          <div className="mt-3 flex items-center gap-1.5 text-tiny font-medium text-fg-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {ROLE_LABELS[session.role]}
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {items.map((item) => {
            if (item.children) return <NavGroup key={item.label} entry={item} />;
            const Ic = Icon[item.icon];
            return (
              <NavLink
                key={item.to}
                to={item.to!}
                end={item.to!.split('/').length <= 2}
                className={({ isActive }) => leafClass(isActive)}
              >
                <Ic width={17} height={17} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <button onClick={async () => { await signOut(); navigate('/login'); }} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium text-fg-secondary transition-colors hover:bg-subtle hover:text-fg">
            <Icon.logout width={17} height={17} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col bg-page">
        <TopHeader role={session.role} initials={initials} displayName={session.displayName}
          email={session.email} onSignOut={async () => { await signOut(); navigate('/login'); }} />
        <main className="flex-1 overflow-auto p-5">
          <div className="mx-auto w-full max-w-[1400px] animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </PageTitleProvider>
  );
}

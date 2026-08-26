import { Link, useLocation } from 'react-router-dom';
import type { Role } from '../auth/roles';
import { NAV, type NavEntry } from './nav';

/** Group whose children include the current path, if any. Exact match only — every current NAV
 * child is a standalone leaf route, and a detail page nested under one (e.g. `/app/offers/:id`)
 * is its own page with its own tabs, not part of the list page's section-tabs strip. */
function activeGroup(entries: NavEntry[], pathname: string): NavEntry | undefined {
  return entries.find((e) => (e.children ?? []).some((c) => pathname === c.to));
}

function activeChildTo(group: NavEntry, pathname: string): string {
  return (group.children ?? []).find((c) => c.to === pathname)?.to ?? '';
}

/**
 * In-page sub-route tabs for grouped nav sections (Offers, Reports, Affiliates, Advertisers).
 * The sidebar rail is icon-only and links straight to a group's first child — this strip is how
 * the rest of that group's routes stay reachable. Rendered once, generically, from `NAV` + the
 * current path, so shared pages (e.g. TagsManage under two different groups) automatically pick
 * up whichever group they were reached through. Renders nothing outside a grouped section.
 */
export function SectionTabs({ role }: { role: Role }) {
  const { pathname } = useLocation();
  const group = activeGroup(NAV[role] ?? [], pathname);
  if (!group) return null;
  const activeTo = activeChildTo(group, pathname);

  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {(group.children ?? []).map((c) => {
        const on = c.to === activeTo;
        return (
          <Link
            key={c.to}
            to={c.to}
            className={`-mb-px whitespace-nowrap rounded-t-[var(--radius)] px-3.5 py-2 text-small font-medium transition-colors ${
              on ? 'border-b-2 border-accent text-accent-text' : 'border-b-2 border-transparent text-fg-secondary hover:text-fg'
            }`}
          >
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}

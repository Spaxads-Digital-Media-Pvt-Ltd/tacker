/**
 * Top-right profile dropdown (Section 5). Opens on the avatar; elevated panel with an identity block,
 * the role's own navigation items and a terminal Log out (danger).
 * Closes on outside-click and Esc; keyboard-accessible (menu items are real links/buttons).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Bell, CreditCard, LogOut, ChevronDown, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Role } from '../../auth/roles';
import { usePlatformMe } from '../../lib/platformMe';

interface Item { label: string; to: string; icon: LucideIcon }
/** Only routes the role can open: the profile / billing pages exist on the network-staff surface
 * (/app/*) alone. The publisher / advertiser portals have none, so their menu is identity + Log out;
 * the Super Admin console gets /admin/* items its platform role may open (below). */
const ITEMS: Record<Role, Item[]> = {
  admin: [
    { label: 'Account', to: '/app/profile', icon: User },
    // Kept reachable here after the sidebar user-card + kebab was removed.
    { label: 'Notification Preferences', to: '/app/profile/notifications', icon: Bell },
    { label: 'Billing', to: '/app/billing', icon: CreditCard },
  ],
  // Super Admin: built per member below — "My security" only when the role may open Team & roles.
  super_admin: [],
  publisher: [],
  advertiser: [],
};

export function ProfileMenu({ role, initials, displayName, email, onSignOut }: {
  role: Role; initials: string; displayName: string; email: string; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const platform = usePlatformMe();
  const items = role === 'super_admin'
    ? (platform.can('team') ? [{ label: 'My security', to: '/admin/team', icon: ShieldCheck }] : [])
    : ITEMS[role] ?? [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        className="flex min-h-11 items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors duration-fast hover:bg-subtle sm:pr-2.5"
      >
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full border border-border bg-accent-subtle text-tiny font-semibold text-accent-text">{initials}</span>
        <span className="hidden max-w-[10rem] truncate text-small font-medium text-header-fg sm:block">{displayName}</span>
        <ChevronDown size={14} aria-hidden className={`hidden text-fg-muted transition-transform duration-fast sm:block ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 origin-top-right animate-fade-in rounded-card border border-border bg-elevated p-1.5 shadow-elevated">
          {/* Identity block */}
          <div className="flex items-center gap-2.5 border-b border-border px-2.5 py-2.5">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-small font-semibold text-on-accent">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-small font-semibold text-fg">{displayName}</p>
              <p className="truncate text-tiny text-fg-secondary">{email}</p>
            </div>
          </div>

          {items.length > 0 && (
            <div className="py-1">
              {items.map((it) => (
                <Link
                  key={it.label}
                  to={it.to}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-fg transition-colors duration-fast hover:bg-accent-subtle"
                >
                  <it.icon size={16} aria-hidden className="shrink-0 text-fg-secondary" /> {it.label}
                </Link>
              ))}
            </div>
          )}

          <div className={items.length > 0 ? 'border-t border-border pt-1' : 'pt-1'}>
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onSignOut(); }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-danger-text transition-colors duration-fast hover:bg-danger-bg"
            >
              <LogOut size={16} aria-hidden className="shrink-0" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

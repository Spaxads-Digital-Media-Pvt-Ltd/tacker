/**
 * Top-right profile dropdown (Section 5). Opens on the avatar; light elevated panel with an identity
 * block + navigation items (Profile / Teams / Billing / Settings) and a terminal Log out (danger).
 * Closes on outside-click and Esc; keyboard-accessible (menu items are real links/buttons).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Users, CreditCard, Settings, LogOut, type LucideIcon } from 'lucide-react';

interface Item { label: string; to: string; icon: LucideIcon }
const ITEMS: Item[] = [
  { label: 'Profile', to: '/app/profile', icon: User },
  { label: 'Teams', to: '/app/settings', icon: Users },
  { label: 'Billing', to: '/app/invoices', icon: CreditCard },
  { label: 'Settings', to: '/app/settings', icon: Settings },
];

export function ProfileMenu({ initials, displayName, email, onSignOut }: {
  initials: string; displayName: string; email: string; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-[var(--radius)] px-1 py-1 transition-colors hover:bg-accent-subtle"
      >
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-tiny font-semibold text-white">{initials}</span>
        <span className="hidden text-small font-medium text-fg sm:block">{displayName}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 origin-top-right animate-fade-in rounded-card border border-border bg-elevated p-1.5 shadow-elevated">
          {/* Identity block */}
          <div className="flex items-center gap-2.5 border-b border-border px-2.5 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-small font-semibold text-white">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-small font-semibold text-fg">{displayName}</p>
              <p className="truncate text-tiny text-fg-secondary">{email}</p>
            </div>
          </div>

          <div className="py-1">
            {ITEMS.map((it) => (
              <Link
                key={it.label}
                to={it.to}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-fg transition-colors hover:bg-accent-subtle"
              >
                <it.icon size={16} className="shrink-0 text-fg-secondary" /> {it.label}
              </Link>
            ))}
          </div>

          <div className="border-t border-border pt-1">
            <button
              role="menuitem"
              onClick={() => { setOpen(false); onSignOut(); }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-danger-text transition-colors hover:bg-danger-bg"
            >
              <LogOut size={16} className="shrink-0" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

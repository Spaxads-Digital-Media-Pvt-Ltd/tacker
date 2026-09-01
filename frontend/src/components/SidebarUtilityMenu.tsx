/**
 * The reference's own bottom-of-rail trio — bell (notifications), person (account), question mark
 * (help) — verified live: the bell opens a real "Recent Notifications" popover, the person opens an
 * identity block + My Account/Logout, the question mark opens a small help popover. Each opens as a
 * popover to the right of its icon (matching RailTip's own `left-full` convention), closes on
 * outside-click/Esc.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { Bell, User, HelpCircle, BookOpen, Keyboard, Mail } from 'lucide-react';
import { useQuery } from '../lib/useApi';

interface HistoryRow {
  id: string; ref: number; operationTime: string; service: string; changes: string; isNew: boolean;
  employee: string; method: string; portal: string; userIp: string | null; userAgent: string | null;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);        // trigger wrapper
  const panelRef = useRef<HTMLDivElement>(null);   // the portaled panel (lives under <body>)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel is portaled out of `ref`, so check both subtrees before treating a click as "outside".
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref, panelRef };
}

const RAIL_IDLE = 'text-[rgb(var(--sidebar-fg))] hover:bg-[rgb(var(--sidebar-hover-bg))] hover:text-[rgb(var(--sidebar-fg-strong))]';
const RAIL_ON = 'bg-[rgb(var(--sidebar-active-bg))] text-[rgb(var(--sidebar-fg-strong))]';

function RailIconButton({ expanded, label, children, onClick, badge }: { expanded: boolean; label: string; children: ReactNode; onClick: () => void; badge?: boolean }) {
  const cls = `transition-colors ${RAIL_IDLE}`;
  return expanded ? (
    <button type="button" onClick={onClick}
<<<<<<< HEAD
      className={`flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium ${cls}`}>
=======
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-small font-medium text-[#94A3B8] dark:text-[#94A3B8] transition-colors hover:bg-[#1E293B] dark:hover:bg-[#1E293B] hover:text-white">
>>>>>>> d0345fb7d8046c1797198cf5c82dd57cacd88c13
      <span className="relative shrink-0">{children}{badge && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger" />}</span>
      {label}
    </button>
  ) : (
    <button type="button" onClick={onClick} aria-label={label}
<<<<<<< HEAD
      className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] ${cls}`}>
=======
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#94A3B8] dark:text-[#94A3B8] transition-colors hover:bg-[#1E293B] dark:hover:bg-[#1E293B] hover:text-white">
>>>>>>> d0345fb7d8046c1797198cf5c82dd57cacd88c13
      {children}
      {badge && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />}
    </button>
  );
}

/**
 * "Account" — a plain nav link to the profile page, styled like every other rail item. Replaces
 * the old bottom-of-rail user card + kebab popover: identity + Logout live in the top-header
 * ProfileMenu, Notification Preferences is reachable from there too, so the rail just needs a
 * one-click path to /app/profile with no floating menu to position.
 */
export function AccountLink({ expanded }: { expanded: boolean }) {
  const on = useLocation().pathname.startsWith('/app/profile');
  return expanded ? (
    <Link to="/app/profile"
      className={`flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium transition-colors ${on ? RAIL_ON : RAIL_IDLE}`}>
      <User size={18} className="shrink-0" /> Account
    </Link>
  ) : (
    <Link to="/app/profile" aria-label="Account"
      className={`group relative grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] transition-colors ${on ? RAIL_ON : RAIL_IDLE}`}>
      <User size={18} />
    </Link>
  );
}

/**
 * Rail popover — portaled to <body> (like NavFlyout) so it can't be trapped by the sidebar's
 * stacking context (the rail carries a `transform` for the responsive drawer, which would
 * otherwise pin an `absolute`/`z-50` child behind the main content). Anchored to the right of
 * its trigger and bottom-aligned to it (opens upward — these triggers sit at the foot of the
 * rail). Collision-aware: falls back to opening downward, then to a pinned + scrolling panel,
 * if there isn't room above. Re-measures on resize and on the panel's own size changes.
 */
function Popover({ anchorRef, panelRef, children }: {
  anchorRef: RefObject<HTMLElement>;
  panelRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const GAP = 8;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const { innerWidth: vw, innerHeight: vh } = window;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;

      // Horizontal: open to the right of the rail; if it won't fit, flip to the left of the
      // trigger; clamp to the viewport as a last resort.
      let left = a.right + GAP;
      if (left + pw > vw - GAP) left = a.left - GAP - pw;
      left = Math.min(Math.max(GAP, left), Math.max(GAP, vw - GAP - pw));

      // Vertical: prefer bottom-aligned to the trigger (opens upward) — the common case here.
      const spaceAbove = a.bottom - GAP;
      const spaceBelow = vh - GAP - a.top;
      let top: number;
      let maxHeight: number | undefined;
      if (ph <= spaceAbove) top = a.bottom - ph;
      else if (ph <= spaceBelow) top = a.top;
      else { top = GAP; maxHeight = vh - GAP * 2; }

      setPos({ left, top, maxHeight });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(panel);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  }, [anchorRef, panelRef]);

  return createPortal(
    <div
      ref={panelRef}
      style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
      className="fixed z-50 w-80 animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated shadow-elevated"
    >
      {children}
    </div>,
    document.body,
  );
}

export function NotificationsBell({ expanded }: { expanded: boolean }) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const { data } = useQuery<HistoryRow[]>(open ? '/api/audit-log' : null);
  const rows = (data ?? []).slice(0, 6);
  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Notifications" onClick={() => setOpen((o) => !o)}><Bell size={18} /></RailIconButton>
      {open && (
        <Popover anchorRef={ref} panelRef={panelRef}>
          <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
            <h3 className="text-small font-semibold text-fg">Recent Notifications</h3>
            <Link to="/app/control-center/accounts" onClick={() => setOpen(false)} className="text-tiny font-medium text-accent-text">Browse all</Link>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-small text-fg-muted">No recent activity.</p>
            ) : rows.map((r) => (
              <div key={r.id} className="border-b border-border px-3.5 py-2.5 last:border-0">
                <p className="text-small text-fg">{r.isNew ? 'New' : ''} {r.service} {r.isNew ? 'created' : 'updated'}</p>
                <p className="mt-0.5 text-tiny text-fg-secondary">{r.employee} · {timeAgo(r.operationTime)}</p>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}


export function HelpMenu({ expanded }: { expanded: boolean }) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const supportEmail = `support@${window.location.hostname}`;
  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Help" onClick={() => setOpen((o) => !o)}><HelpCircle size={18} /></RailIconButton>
      {open && (
        <Popover anchorRef={ref} panelRef={panelRef}>
          <div className="border-b border-border px-3.5 py-3">
            <h3 className="text-small font-semibold text-fg">Help &amp; Support</h3>
          </div>
          <div className="p-1.5">
            <button title="Not available yet" className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left text-small font-medium text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg">
              <BookOpen size={16} className="shrink-0" /> Documentation
            </button>
            <button title="Not available yet" className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left text-small font-medium text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg">
              <Keyboard size={16} className="shrink-0" /> Keyboard Shortcuts
            </button>
            <a href={`mailto:${supportEmail}`} onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-fg transition-colors hover:bg-accent-subtle">
              <Mail size={16} className="shrink-0 text-fg-secondary" /> Contact Support
            </a>
          </div>
        </Popover>
      )}
    </div>
  );
}

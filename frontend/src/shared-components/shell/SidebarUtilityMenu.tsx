/**
 * The reference's own bottom-of-rail trio — bell (notifications), person (account), question mark
 * (help) — verified live: the bell opens a real "Recent Notifications" popover, the person opens an
 * identity block + My Account/Logout, the question mark opens a small help popover. Each opens as a
 * popover to the right of its icon (matching RailTip's own `left-full` convention), closes on
 * outside-click/Esc.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, User, HelpCircle, BookOpen, Keyboard, Mail, Sparkles, Activity } from 'lucide-react';
import { Modal } from '../primitives/ui';
import { ROLE_HOME } from '../../auth/roles';
import { changelogSeenAt, hasUnread } from '../../lib/changelogSeen';
import { useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

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
      className={`flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-small font-medium ${cls}`}>
      <span className="relative shrink-0">{children}{badge && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger" />}</span>
      {label}
    </button>
  ) : (
    <button type="button" onClick={onClick} aria-label={label}
      className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] ${cls}`}>
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
  // The tenant audit log is network staff's — the shell only shows the bell to them (N1); the guard
  // stays so nothing else (a Super Admin session, a portal) ever asks for it.
  const { session } = useAuth();
  const { data } = useQuery<HistoryRow[]>(session?.role === 'admin' ? '/api/audit-log' : null);
  const rows = (data ?? []).slice(0, 8);
  const hasNew = (data ?? []).some((r) => r.isNew);

  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Notifications" onClick={() => setOpen((o) => !o)} badge={hasNew}>
        <Bell size={18} />
      </RailIconButton>
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
                <p className="text-small text-fg">
                  {r.isNew && <span className="mr-1.5 rounded bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success-text">New</span>}
                  {r.service} {r.isNew ? 'created' : 'updated'}
                </p>
                <p className="mt-0.5 text-tiny text-fg-secondary">{r.employee} · {timeAgo(r.operationTime)}</p>
                {r.changes && <p className="mt-0.5 line-clamp-1 text-tiny text-fg-muted">{r.changes}</p>}
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <Link
              to="/app/profile/notifications"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center rounded-[var(--radius)] px-2.5 py-2 text-tiny font-medium text-accent-text hover:bg-accent-subtle"
            >
              Notification Preferences
            </Link>
          </div>
        </Popover>
      )}
    </div>
  );
}


interface PlatformNotice { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

/** The Super Admin console's bell — notices for this member (a ticket, a reply, a lead or a task for them). */
export function PlatformBell({ expanded }: { expanded: boolean }) {
  const { open, setOpen, ref, panelRef } = usePopover();
  const navigate = useNavigate();
  const q = useQuery<{ unread: number; items: PlatformNotice[] }>('/platform/notifications');
  const { refetch } = q;
  useEffect(() => {
    const t = window.setInterval(refetch, 60_000);
    return () => window.clearInterval(t);
  }, [refetch]);
  const unread = q.data?.unread ?? 0;
  const items = q.data?.items ?? [];
  const openNotice = async (n: PlatformNotice) => {
    setOpen(false);
    if (!n.read_at) await api.post(`/platform/notifications/${n.id}/read`, {}).catch(() => undefined);
    refetch();
    if (n.link?.startsWith('/')) navigate(n.link);
  };
  const readAll = async () => { await api.post('/platform/notifications/read-all', {}).catch(() => undefined); refetch(); };

  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label={unread ? `Notifications (${unread} unread)` : 'Notifications'} onClick={() => { setOpen((o) => !o); if (!open) refetch(); }} badge={unread > 0}>
        <Bell size={18} />
      </RailIconButton>
      {open && (
        <Popover anchorRef={ref} panelRef={panelRef}>
          <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
            <h3 className="text-small font-semibold text-fg">Notifications{unread > 0 && <span className="ml-1.5 text-fg-muted">· {unread} new</span>}</h3>
            {unread > 0 && <button type="button" onClick={() => void readAll()} className="text-tiny font-medium text-accent-text hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-small text-fg-muted">Nothing for you yet.</p>
            ) : items.map((n) => (
              <button key={n.id} type="button" onClick={() => void openNotice(n)}
                className={`block w-full border-b border-border px-3.5 py-2.5 text-left last:border-0 hover:bg-accent-subtle ${n.read_at ? '' : 'bg-accent-subtle/40'}`}>
                <p className="text-small text-fg">
                  {!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-label="Unread" />}
                  {n.title}
                </p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-tiny text-fg-secondary">{n.body}</p>}
                <p className="mt-0.5 text-tiny text-fg-muted">{n.kind} · {timeAgo(n.created_at)}</p>
              </button>
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
  // Network staff ask the platform's support team in the app (tickets); the Super Admin console has the desk.
  const { session } = useAuth();
  const role = session?.role;
  // Re-read on navigation (cheap), so the badge clears once they answer or resolve.
  const { pathname } = useLocation();
  const tickets = useQuery<{ open: number; waiting_on_you: number }>(role === 'admin' ? '/api/support/summary' : null, { at: pathname.startsWith('/app/support') ? pathname : undefined });
  const waiting = tickets.data?.waiting_on_you ?? 0;
  const home = role ? ROLE_HOME[role] : '/app';
  // "What's new": a dot until the newest published entry has been seen (per browser).
  const changelog = useQuery<{ published_at: string | null }[]>(role && role !== 'super_admin' ? '/api/help/changelog' : null);
  const unread = hasUnread(changelog.data?.[0]?.published_at, changelogSeenAt());
  const [shortcuts, setShortcuts] = useState(false);
  const itemCls = 'flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-fg transition-colors hover:bg-accent-subtle';
  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Help" onClick={() => setOpen((o) => !o)} badge={waiting > 0 || unread}><HelpCircle size={18} /></RailIconButton>
      {open && (
        <Popover anchorRef={ref} panelRef={panelRef}>
          <div className="border-b border-border px-3.5 py-3">
            <h3 className="text-small font-semibold text-fg">Help &amp; Support</h3>
          </div>
          <div className="p-1.5">
            <Link to={role === 'super_admin' ? '/admin/help-center' : `${home}/help`} onClick={() => setOpen(false)} className={itemCls}>
              <BookOpen size={16} className="shrink-0 text-fg-secondary" /> {role === 'super_admin' ? 'Help center (manage)' : 'Help center'}
            </Link>
            {role !== 'super_admin' && (
              <Link to={`${home}/whats-new`} onClick={() => setOpen(false)} className={itemCls}>
                <Sparkles size={16} className="shrink-0 text-fg-secondary" /> What’s new
                {unread && <span className="ml-auto h-2 w-2 rounded-full bg-accent" aria-label="New" />}
              </Link>
            )}
            <button type="button" onClick={() => { setOpen(false); setShortcuts(true); }} className={itemCls}>
              <Keyboard size={16} className="shrink-0 text-fg-secondary" /> Keyboard shortcuts
            </button>
            <a href="/status" target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={itemCls}>
              <Activity size={16} className="shrink-0 text-fg-secondary" /> System status
            </a>
            {role === 'admin' ? (
              <Link to="/app/support" onClick={() => setOpen(false)} className={itemCls}>
                <Mail size={16} className="shrink-0 text-fg-secondary" /> Contact Support
                {waiting > 0 && <span className="ml-auto rounded-full bg-warning-bg px-1.5 text-tiny font-semibold text-warning-text">{waiting} awaiting you</span>}
              </Link>
            ) : role === 'super_admin' ? (
              <Link to="/admin/support" onClick={() => setOpen(false)} className={itemCls}>
                <Mail size={16} className="shrink-0 text-fg-secondary" /> Support desk
              </Link>
            ) : (
              <a href={`mailto:${supportEmail}`} onClick={() => setOpen(false)} className={itemCls}>
                <Mail size={16} className="shrink-0 text-fg-secondary" /> Contact Support
              </a>
            )}
          </div>
        </Popover>
      )}
      {shortcuts && (
        <Modal open onClose={() => setShortcuts(false)} title="Keyboard shortcuts"
          footer={<button type="button" className="btn-primary" onClick={() => setShortcuts(false)}>Close</button>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-small">
            {SHORTCUTS.map(([keys, what]) => (
              <Fragment key={what}>
                <dt>{keys.map((k) => <kbd key={k} className="mr-1 rounded border border-border bg-page px-1.5 py-0.5 font-mono text-tiny">{k}</kbd>)}</dt>
                <dd className="text-fg-secondary">{what}</dd>
              </Fragment>
            ))}
          </dl>
        </Modal>
      )}
    </div>
  );
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const SHORTCUTS: [string[], string][] = [
  [[MOD, 'K'], 'Search — offers, partners, advertisers, pages'],
  [['Esc'], 'Close a dialog, menu or search'],
  [['Enter'], 'Submit the focused form'],
  [['Tab'], 'Move to the next field or button'],
];

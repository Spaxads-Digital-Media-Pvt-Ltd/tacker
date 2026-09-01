/**
 * The reference's own bottom-of-rail trio — bell (notifications), person (account), question mark
 * (help) — verified live: the bell opens a real "Recent Notifications" popover, the person opens an
 * identity block + My Account/Logout, the question mark opens a small help popover. Each opens as a
 * popover to the right of its icon (matching RailTip's own `left-full` convention), closes on
 * outside-click/Esc.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, User, LogOut, HelpCircle, BookOpen, Keyboard, Mail } from 'lucide-react';
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

function RailIconButton({ expanded, label, children, onClick, badge }: { expanded: boolean; label: string; children: ReactNode; onClick: () => void; badge?: boolean }) {
  return expanded ? (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-small font-medium text-[#94A3B8] dark:text-[#94A3B8] transition-colors hover:bg-[#1E293B] dark:hover:bg-[#1E293B] hover:text-white">
      <span className="relative shrink-0">{children}{badge && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger" />}</span>
      {label}
    </button>
  ) : (
    <button type="button" onClick={onClick} aria-label={label}
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#94A3B8] dark:text-[#94A3B8] transition-colors hover:bg-[#1E293B] dark:hover:bg-[#1E293B] hover:text-white">
      {children}
      {badge && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />}
    </button>
  );
}

function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-0 left-full z-50 ml-2 w-80 animate-fade-in rounded-card border border-border bg-elevated shadow-elevated">
      {children}
    </div>
  );
}

export function NotificationsBell({ expanded }: { expanded: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const { data } = useQuery<HistoryRow[]>(open ? '/api/audit-log' : null);
  const rows = (data ?? []).slice(0, 6);
  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Notifications" onClick={() => setOpen((o) => !o)}><Bell size={18} /></RailIconButton>
      {open && (
        <Popover>
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

export function ProfileRailMenu({ expanded, initials, displayName, email, onSignOut }: {
  expanded: boolean; initials: string; displayName: string; email: string; onSignOut: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Account" onClick={() => setOpen((o) => !o)}><User size={18} /></RailIconButton>
      {open && (
        <Popover>
          <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-small font-semibold text-white">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-small font-semibold text-fg">{displayName}</p>
              <p className="truncate text-tiny text-fg-secondary">{email}</p>
            </div>
          </div>
          <div className="p-1.5">
            <Link to="/app/profile" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-fg transition-colors hover:bg-accent-subtle">
              <User size={16} className="shrink-0 text-fg-secondary" /> My Account
            </Link>
            <Link to="/app/profile/notifications" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-fg transition-colors hover:bg-accent-subtle">
              <Bell size={16} className="shrink-0 text-fg-secondary" /> My Notification Preferences
            </Link>
          </div>
          <div className="border-t border-border p-1.5">
            <button type="button" onClick={() => { setOpen(false); onSignOut(); }}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-small font-medium text-danger-text transition-colors hover:bg-danger-bg">
              <LogOut size={16} className="shrink-0" /> Logout
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}

export function HelpMenu({ expanded }: { expanded: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const supportEmail = `support@${window.location.hostname}`;
  return (
    <div className="relative" ref={ref}>
      <RailIconButton expanded={expanded} label="Help" onClick={() => setOpen((o) => !o)}><HelpCircle size={18} /></RailIconButton>
      {open && (
        <Popover>
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

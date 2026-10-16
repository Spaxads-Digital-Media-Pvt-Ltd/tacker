/**
 * The platform's announcements across the top of a network's dashboard (staff and portals, as each was
 * targeted — Super Admin › Announcements): news, warnings, a maintenance window in local time; a link; dismiss
 * (remembered per person on the server).
 */
import { useState } from 'react';
import { Info, Megaphone, TriangleAlert, Wrench, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Announcement } from '../../lib/useNetworkBranding';

const TONE: Record<Announcement['kind'], { cls: string; icon: typeof Info }> = {
  info: { cls: 'border-info/30 bg-info-bg text-info-text', icon: Info },
  success: { cls: 'border-success/30 bg-success-bg text-success-text', icon: Megaphone },
  warning: { cls: 'border-warning/30 bg-warning-bg text-warning-text', icon: TriangleAlert },
  critical: { cls: 'border-danger/30 bg-danger-bg text-danger-text', icon: TriangleAlert },
  maintenance: { cls: 'border-warning/30 bg-warning-bg text-warning-text', icon: Wrench },
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** `preview` (the Super Admin's editor): dismissing only hides it here. */
export function AnnouncementBanner({ announcements, preview = false }: { announcements: Announcement[]; preview?: boolean }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = announcements.filter((a) => !hidden.includes(a.id));
  if (!shown.length) return null;
  const dismiss = (id: string) => {
    setHidden((h) => [...h, id]);
    if (!preview) void api.post(`/api/announcements/${id}/dismiss`, {}).catch(() => undefined);
  };
  return (
    <>
      {shown.map((a) => {
        const { cls, icon: Icon } = TONE[a.kind] ?? TONE.info;
        const safeLink = a.link_url && /^https?:\/\//i.test(a.link_url) ? a.link_url : null;
        return (
          <div key={a.id} role={a.kind === 'critical' ? 'alert' : 'status'} className={`flex items-start gap-3 border-b px-4 py-2 text-small ${cls}`}>
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <strong>{a.title}</strong>
              {a.kind === 'maintenance' && a.maintenance_starts_at && a.maintenance_ends_at && (
                <span> · {when(a.maintenance_starts_at)} – {when(a.maintenance_ends_at)}</span>
              )}
              <span className="ml-1">{a.body}</span>
              {safeLink && <a href={safeLink} target="_blank" rel="noreferrer noopener" className="ml-2 font-medium underline">{a.link_label || 'Learn more'}</a>}
            </div>
            {a.dismissible && <button type="button" aria-label={`Dismiss “${a.title}”`} className="shrink-0 opacity-70 hover:opacity-100" onClick={() => dismiss(a.id)}><X size={16} /></button>}
          </div>
        );
      })}
    </>
  );
}

/**
 * Super Admin › Platform › Announcements — banners in tenant dashboards: news, warnings, maintenance windows.
 * Write one (a preview shows how it looks), choose who sees it (all networks / plans / chosen networks; staff,
 * partner or advertiser portals) and when; publish, unpublish, archive. Counts who dismissed it.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import type { PlatformPlan } from '../../../lib/platformBilling';
import type { Announcement as Banner } from '../../../lib/useNetworkBranding';
import { toLocalInput, fromLocalInput } from '../../../lib/platformSales';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { SearchablePicker } from '../../../shared-components/primitives/SearchablePicker';
import { AnnouncementBanner } from '../../../shared-components/shell/AnnouncementBanner';
import { useAllNetworks } from '../useAllNetworks';
import { Chip } from '../kit';

interface Ann {
  id: string; title: string; body: string; kind: Banner['kind']; audience: 'all' | 'plans' | 'networks'; plan_ids: string[]; network_ids: string[];
  roles: ('admin' | 'publisher' | 'advertiser')[]; starts_at: string; ends_at: string | null; maintenance_starts_at: string | null; maintenance_ends_at: string | null;
  dismissible: boolean; link_url: string | null; link_label: string | null; status: 'draft' | 'published' | 'archived'; live: boolean; dismissals: number;
  created_by_name: string | null; published_at: string | null;
}
const KINDS: { value: Banner['kind']; label: string }[] = [
  { value: 'info', label: 'News' }, { value: 'success', label: 'Good news' }, { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' }, { value: 'maintenance', label: 'Maintenance window' },
];
const ROLES = [{ value: 'admin', label: 'Network staff' }, { value: 'publisher', label: 'Partner portals' }, { value: 'advertiser', label: 'Advertiser portals' }] as const;

function stateOf(a: Ann): { label: string; cls: string } {
  if (a.status === 'draft') return { label: 'Draft', cls: 'bg-page text-fg-secondary ring-1 ring-inset ring-border' };
  if (a.status === 'archived') return { label: 'Archived', cls: 'bg-page text-fg-muted ring-1 ring-inset ring-border' };
  if (a.live) return { label: 'Live', cls: 'bg-success-bg text-success-text' };
  return new Date(a.starts_at) > new Date() ? { label: 'Scheduled', cls: 'bg-info-bg text-info-text' } : { label: 'Ended', cls: 'bg-page text-fg-muted ring-1 ring-inset ring-border' };
}

export default function Announcements() {
  const canEdit = usePlatformMe().can('comms', 'full');
  const list = useQuery<Ann[]>('/platform/announcements');
  const plans = useQuery<PlatformPlan[]>('/platform/plans');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Ann | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (a: Ann, path: string) => {
    setError(null);
    try { await api.post(`/platform/announcements/${a.id}/${path}`, {}); list.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update'); }
  };
  const audience = (a: Ann) => (a.audience === 'all' ? 'Every network' : a.audience === 'plans'
    ? `Plans: ${a.plan_ids.map((id) => (plans.data ?? []).find((p) => p.id === id)?.name ?? 'a plan').join(', ')}` : `${a.network_ids.length} chosen network(s)`);
  return (
    <>
      <PageHeader title="Announcements" subtitle="Banners in your customers’ dashboards — news, warnings, maintenance windows."
        action={canEdit ? <button className="btn-primary" onClick={() => setEditing('new')}>New announcement</button> : undefined} />
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock>
        : list.error ? <StateBlock>{list.error}</StateBlock>
        : (list.data ?? []).length === 0 ? <StateBlock>No announcements yet.</StateBlock>
        : (
          <div className="space-y-3">
            {list.data!.map((a) => {
              const st = stateOf(a);
              return (
                <div key={a.id} className="card space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">{a.title} <span className="ml-1 text-tiny font-normal text-fg-muted">{KINDS.find((k) => k.value === a.kind)?.label}</span></p>
                      <p className="line-clamp-2 text-small text-fg-secondary">{a.body}</p>
                    </div>
                    <Chip className={st.cls}>{st.label}</Chip>
                  </div>
                  <p className="text-tiny text-fg-muted">
                    {audience(a)} · {a.roles.map((r) => ROLES.find((x) => x.value === r)?.label).join(', ')} · from {new Date(a.starts_at).toLocaleString()}{a.ends_at ? ` until ${new Date(a.ends_at).toLocaleString()}` : ''}
                    {a.status !== 'draft' && ` · dismissed by ${a.dismissals}`}{a.created_by_name ? ` · by ${a.created_by_name}` : ''}{a.published_at ? ` · published ${relTime(a.published_at)}` : ''}
                  </p>
                  {canEdit && (
                    <div className="flex flex-wrap gap-3 border-t border-border pt-2">
                      <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setEditing(a)}>Edit</button>
                      {a.status !== 'published' && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => void act(a, 'publish')}>Publish</button>}
                      {a.status === 'published' && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => void act(a, 'unpublish')}>Back to draft</button>}
                      {a.status !== 'archived' && <button className="text-tiny font-medium text-fg-secondary hover:underline" onClick={() => void act(a, 'archive')}>Archive</button>}
                      <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => confirm({
                        title: `Delete “${a.title}”?`, confirmLabel: 'Delete', destructive: true, message: 'It disappears from every dashboard.',
                        onConfirm: async () => { await api.del(`/platform/announcements/${a.id}`); list.refetch(); },
                      })}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {editing && <AnnouncementForm ann={editing === 'new' ? null : editing} plans={plans.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.refetch(); }} />}
    </>
  );
}

function AnnouncementForm({ ann, plans, onClose, onSaved }: { ann: Ann | null; plans: PlatformPlan[]; onClose: () => void; onSaved: () => void }) {
  const networks = useAllNetworks();
  const [f, setF] = useState({
    title: ann?.title ?? '', body: ann?.body ?? '', kind: ann?.kind ?? 'info' as Banner['kind'], audience: ann?.audience ?? 'all' as Ann['audience'],
    planIds: ann?.plan_ids ?? [], networkIds: ann?.network_ids ?? [], roles: ann?.roles ?? ['admin'] as Ann['roles'],
    startsAt: toLocalInput(ann?.starts_at ?? new Date().toISOString()), endsAt: toLocalInput(ann?.ends_at), mStart: toLocalInput(ann?.maintenance_starts_at), mEnd: toLocalInput(ann?.maintenance_ends_at),
    dismissible: ann?.dismissible ?? true, linkUrl: ann?.link_url ?? '', linkLabel: ann?.link_label ?? '',
  });
  const m = useMutation((b: Record<string, unknown>) => (ann ? api.patch(`/platform/announcements/${ann.id}`, b) : api.post('/platform/announcements', b)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      title: f.title.trim(), body: f.body.trim(), kind: f.kind, audience: f.audience, planIds: f.audience === 'plans' ? f.planIds : [], networkIds: f.audience === 'networks' ? f.networkIds : [],
      roles: f.roles, startsAt: fromLocalInput(f.startsAt) ?? new Date().toISOString(), endsAt: fromLocalInput(f.endsAt),
      maintenanceStartsAt: f.kind === 'maintenance' ? fromLocalInput(f.mStart) : null, maintenanceEndsAt: f.kind === 'maintenance' ? fromLocalInput(f.mEnd) : null,
      dismissible: f.dismissible, linkUrl: f.linkUrl.trim() || null, linkLabel: f.linkLabel.trim(),
    };
    if (await m.run(body)) onSaved();
  };
  const preview: Banner = {
    id: 'preview', title: f.title || 'Your title', body: f.body || 'What you want them to know.', kind: f.kind, dismissible: f.dismissible,
    link_url: f.linkUrl || null, link_label: f.linkLabel || null, maintenance_starts_at: fromLocalInput(f.mStart), maintenance_ends_at: fromLocalInput(f.mEnd),
  };
  return (
    <Modal open size="xl" onClose={onClose} title={ann ? 'Edit announcement' : 'New announcement'}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <div className="overflow-hidden rounded-[var(--radius)] border border-border"><AnnouncementBanner key={JSON.stringify(preview)} announcements={[preview]} preview /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Title"><input className="input" required maxLength={160} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} /></Field></div>
          <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as Banner['kind'] }))}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></Field>
        </div>
        <Field label="Message"><textarea className="input min-h-[80px]" required maxLength={4000} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} /></Field>
        {f.kind === 'maintenance' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Maintenance starts"><input className="input" type="datetime-local" required value={f.mStart} onChange={(e) => setF((s) => ({ ...s, mStart: e.target.value }))} /></Field>
            <Field label="Maintenance ends"><input className="input" type="datetime-local" required value={f.mEnd} onChange={(e) => setF((s) => ({ ...s, mEnd: e.target.value }))} /></Field>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Show from"><input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => setF((s) => ({ ...s, startsAt: e.target.value }))} /></Field>
          <Field label="Until" hint="Blank = until you archive it"><input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => setF((s) => ({ ...s, endsAt: e.target.value }))} /></Field>
        </div>
        <Field label="Who sees it">
          <div className="flex flex-wrap gap-4">
            {ROLES.map((r) => (
              <label key={r.value} className="flex items-center gap-1.5 text-small text-fg">
                <input type="checkbox" checked={f.roles.includes(r.value)} onChange={(e) => setF((s) => ({ ...s, roles: e.target.checked ? [...s.roles, r.value] : s.roles.filter((x) => x !== r.value) }))} />{r.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Which networks">
          <select className="input max-w-xs" value={f.audience} onChange={(e) => setF((s) => ({ ...s, audience: e.target.value as Ann['audience'] }))}>
            <option value="all">Every network</option><option value="plans">Networks on chosen plans</option><option value="networks">Chosen networks</option>
          </select>
        </Field>
        {f.audience === 'plans' && (
          <div className="flex flex-wrap gap-3">
            {plans.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-small text-fg">
                <input type="checkbox" checked={f.planIds.includes(p.id)} onChange={(e) => setF((s) => ({ ...s, planIds: e.target.checked ? [...s.planIds, p.id] : s.planIds.filter((x) => x !== p.id) }))} />{p.name}
              </label>
            ))}
          </div>
        )}
        {f.audience === 'networks' && (
          <SearchablePicker ariaLabel="Networks" placeholder="Choose networks…" value={f.networkIds} onChange={(v) => setF((s) => ({ ...s, networkIds: v }))}
            options={(networks.data ?? []).filter((n) => n.status !== 'deleted').map((n) => ({ value: n.id, label: n.name, hint: n.slug }))} />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Link" hint="Optional — e.g. the release notes"><input className="input" type="url" value={f.linkUrl} onChange={(e) => setF((s) => ({ ...s, linkUrl: e.target.value }))} placeholder="https://" /></Field>
          <Field label="Link text"><input className="input" maxLength={60} value={f.linkLabel} onChange={(e) => setF((s) => ({ ...s, linkLabel: e.target.value }))} placeholder="Learn more" /></Field>
        </div>
        <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" checked={f.dismissible} onChange={(e) => setF((s) => ({ ...s, dismissible: e.target.checked }))} /> People can dismiss it</label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || f.roles.length === 0}>{m.busy ? 'Saving…' : ann ? 'Save' : 'Save as draft'}</button>
        </div>
      </form>
    </Modal>
  );
}

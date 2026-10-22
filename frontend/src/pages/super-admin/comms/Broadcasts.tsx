/**
 * Super Admin › Comms › Broadcasts — an email to network teams, picked by their role, their network's plan
 * and status. See who it reaches (count + a few addresses) before sending; each one is sent once.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Spinner, StateBlock, Table, type Column } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';
import type { Broadcast } from '../../../lib/platformComms';

const ROLES = [['admin', 'Admins'], ['manager', 'Managers'], ['finance', 'Finance'], ['read_only', 'Read-only']] as const;
type Audience = Broadcast['audience'];

function Composer({ initial, onClose, onSaved }: { initial: Broadcast | null; onClose: () => void; onSaved: () => void }) {
  const plans = useQuery<{ id: string; name: string }[]>('/platform/plans');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [audience, setAudience] = useState<Audience>(initial?.audience ?? { roles: ['admin'], planIds: [], networkStatuses: ['active'] });
  const [preview, setPreview] = useState<{ recipients: number; sample: string[] } | null>(null);
  const save = useMutation((b: Record<string, unknown>) => (initial ? api.patch(`/platform/broadcasts/${initial.id}`, b) : api.post('/platform/broadcasts', b)));
  useEffect(() => {
    let live = true;
    void api.post<{ recipients: number; sample: string[] }>('/platform/broadcasts/preview', { audience }).then((p) => { if (live) setPreview(p); }).catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [audience]);
  const toggle = (k: 'roles' | 'planIds' | 'networkStatuses', v: string) =>
    setAudience((a) => ({ ...a, [k]: a[k].includes(v) ? a[k].filter((x) => x !== v) : [...a[k], v] }));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await save.run({ subject: subject.trim(), body: body.trim(), audience })) onSaved(); };
  return (
    <Modal open size="xl" onClose={onClose} title={initial ? 'Edit broadcast' : 'New broadcast'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="broadcast" className="btn-primary" disabled={save.busy}>Save draft</button></>}>
      <form id="broadcast" onSubmit={submit} className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <Field label="Subject"><input className="input" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message (plain text — a blank line starts a paragraph)"><textarea className="input min-h-[10rem]" required maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><p className="label">Team members who are</p>{ROLES.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-small"><input type="checkbox" checked={audience.roles.includes(v)} onChange={() => toggle('roles', v)} />{l}</label>)}<p className="text-tiny text-fg-muted">None ticked = every role</p></div>
          <div><p className="label">In networks that are</p>{(['active', 'suspended'] as const).map((v) => <label key={v} className="flex items-center gap-2 text-small capitalize"><input type="checkbox" checked={audience.networkStatuses.includes(v)} onChange={() => toggle('networkStatuses', v)} />{v}</label>)}</div>
          <div><p className="label">On the plans</p>{(plans.data ?? []).map((p) => <label key={p.id} className="flex items-center gap-2 text-small"><input type="checkbox" checked={audience.planIds.includes(p.id)} onChange={() => toggle('planIds', p.id)} />{p.name}</label>)}<p className="text-tiny text-fg-muted">None ticked = any plan</p></div>
        </div>
        <p className="rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg">
          {preview ? <>Reaches <strong>{preview.recipients}</strong> {preview.recipients === 1 ? 'person' : 'people'}{preview.sample.length ? <> — e.g. {preview.sample.join(', ')}</> : null}</> : 'Counting recipients…'}
        </p>
      </form>
    </Modal>
  );
}

export default function Broadcasts() {
  const canEdit = usePlatformMe().can('comms', 'full');
  const confirm = useConfirm();
  const list = useQuery<Broadcast[]>('/platform/broadcasts');
  const [editing, setEditing] = useState<Broadcast | null | 'new'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = (b: Broadcast) => void confirm({
    title: 'Send broadcast?', message: `Email "${b.subject}" to its audience now? It is sent once and can’t be changed afterwards.`, confirmLabel: 'Send',
    onConfirm: async () => {
      setError(null); setNotice(null);
      try { const r = await api.post<{ recipients: number; error?: string }>(`/platform/broadcasts/${b.id}/send`, {}); setNotice(r.error ? `Queued for ${r.recipients}, but: ${r.error}` : `Sent to ${r.recipients} people.`); list.refetch(); }
      catch (e) { setError(e instanceof Error ? e.message : 'Send failed'); }
    },
  });
  const columns: Column<Broadcast>[] = [
    { header: 'Subject', cell: (b) => <span className="font-medium text-fg">{b.subject}</span> },
    { header: 'Audience', cell: (b) => <span className="text-small text-fg-secondary">{b.audience.roles.length ? b.audience.roles.join(', ') : 'every role'} · {b.audience.networkStatuses.join(' / ') || 'any network'}{b.audience.planIds.length ? ` · ${b.audience.planIds.length} plan(s)` : ''}</span> },
    { header: 'Status', cell: (b) => (b.status === 'sent' ? <Chip className="bg-success-bg text-success-text">Sent to {b.recipients}</Chip> : <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">{b.status === 'sending' ? 'Sending' : 'Draft'}</Chip>) },
    { header: 'When', cell: (b) => new Date(b.sent_at ?? b.created_at).toLocaleString() },
    { header: 'By', cell: (b) => b.created_by_name ?? '—' },
    { header: '', className: 'text-right', cell: (b) => (canEdit && b.status === 'draft' ? <span className="space-x-3 whitespace-nowrap">
      <button className="text-tiny text-accent-text hover:underline" onClick={() => setEditing(b)}>Edit</button>
      <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => send(b)}>Send</button>
      <button className="text-tiny text-danger-text hover:underline" onClick={() => void confirm({ title: 'Delete draft?', message: `Delete "${b.subject}"?`, confirmLabel: 'Delete', destructive: true, onConfirm: async () => { await api.del(`/platform/broadcasts/${b.id}`); list.refetch(); } })}>Delete</button>
    </span> : null) },
  ];
  return (
    <>
      <PageHeader title="Broadcasts" subtitle="Email network teams — by role, plan and network status."
        action={canEdit ? <button className="btn-primary" onClick={() => setEditing('new')}>New broadcast</button> : undefined} />
      {notice && <p className="mb-3 rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg">{notice}</p>}
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock> : list.error ? <StateBlock>{list.error}</StateBlock>
        : !(list.data ?? []).length ? <StateBlock>No broadcasts yet.</StateBlock> : <Table columns={columns} rows={list.data ?? []} rowKey={(b) => b.id} />}
      {editing && <Composer initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.refetch(); }} />}
    </>
  );
}

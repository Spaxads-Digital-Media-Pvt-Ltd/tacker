/**
 * Super Admin › Trust & safety › Privacy requests — GDPR / CCPA requests about a visitor (an IP, an email, a
 * click id or a sub id value), for one network or every network: log it (due 30 / 45 days from receipt),
 * erase (personal fields of the matching clicks, their raw postback parameters and postback logs — never an
 * amount) or download what is held (access), then complete or reject. The subject is masked once done; a
 * read-only role sees it masked throughout.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { day } from '../../../lib/platformBilling';
import { useStaff, totalOf } from '../../../lib/platformSales';
import {
  PRIVACY_STATUS, REGULATIONS, SUBJECTS, regulationLabel, subjectLabel, type PrivacyRequest, type SubjectType,
} from '../../../lib/platformTrust';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Segmented, Spinner, StateBlock, Table, type Column } from '../../../shared-components/primitives/ui';
import { useAllNetworks } from '../useAllNetworks';
import { StaffSelect } from '../sales/parts';
import { Chip, Pager } from '../kit';

const LIMIT = 50;

export default function PrivacyRequests() {
  const canEdit = usePlatformMe().can('trust', 'full');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<PrivacyRequest | null>(null);
  const list = useQuery<PrivacyRequest[]>('/platform/trust/privacy', { status, q: q.trim() || undefined, limit: LIMIT, offset });

  const cols: Column<PrivacyRequest>[] = [
    { header: 'Request', cell: (p) => (
      <button className="text-left" onClick={() => setOpen(p)}>
        <span className="font-medium text-fg hover:underline">#{p.number} · {p.kind === 'erasure' ? 'Erase data' : 'Copy of data'}</span>
        <span className="block text-tiny text-fg-muted">{regulationLabel(p.regulation)} · received {day(p.received_at)}</span>
      </button>
    ) },
    { header: 'About', cell: (p) => <span className="text-small">{subjectLabel(p.subject_type)} <span className="font-mono text-fg">{p.subject}</span></span> },
    { header: 'Network', cell: (p) => p.network_name ?? <span className="text-fg-secondary">Every network</span> },
    { header: 'Due', cell: (p) => (p.status === 'completed' || p.status === 'rejected'
      ? <span className="text-tiny text-fg-muted">done {relTime(p.completed_at)}</span>
      : <span className={p.overdue ? 'font-medium text-danger-text' : 'text-fg'}>{p.overdue ? `overdue ${relTime(p.due_at)}` : relTime(p.due_at)}</span>) },
    { header: 'Status', cell: (p) => <Chip className={PRIVACY_STATUS[p.status].chip}>{PRIVACY_STATUS[p.status].label}</Chip> },
    { header: 'Owner', cell: (p) => p.assignee_name ?? <span className="text-fg-muted">—</span> },
  ];

  return (
    <>
      <PageHeader title="Privacy requests" subtitle="GDPR and CCPA requests — erase or export what is held about a person."
        action={canEdit ? <button className="btn-primary" onClick={() => setCreating(true)}>Log a request</button> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented className="sm:max-w-md" value={status} onChange={(v) => { setStatus(v); setOffset(0); }}
          options={[{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />
        <input className="input sm:max-w-xs" placeholder="Number, network or requester…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} aria-label="Search requests" />
      </div>
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock>
        : list.error ? <StateBlock>{list.error}</StateBlock>
        : (list.data ?? []).length === 0 ? <StateBlock>{status === 'open' ? 'No open request — nothing is waiting on the team.' : 'Nothing here.'}</StateBlock>
        : <>
          <Table columns={cols} rows={list.data!} rowKey={(p) => p.id} />
          <Pager offset={offset} limit={LIMIT} total={totalOf(list.data)} onChange={setOffset} />
        </>}
      {creating && <NewRequest onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.refetch(); }} />}
      {open && <RequestDetail request={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={(p) => { list.refetch(); if (p) setOpen(p); }} />}
    </>
  );
}

function NewRequest({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const networks = useAllNetworks();
  const staff = useStaff();
  const me = usePlatformMe().me;
  const [f, setF] = useState({
    networkId: '', kind: 'erasure', regulation: 'gdpr', subjectType: 'ip' as SubjectType, subject: '', requesterEmail: '',
    receivedAt: new Date().toISOString().slice(0, 10), notes: '', assigneeId: me?.id ?? '',
  });
  const m = useMutation((b: Record<string, unknown>) => api.post('/platform/trust/privacy', b));
  const reg = REGULATIONS.find((r) => r.value === f.regulation)!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await m.run({
      networkId: f.networkId || null, kind: f.kind, regulation: f.regulation, subjectType: f.subjectType, subject: f.subject.trim(),
      requesterEmail: f.requesterEmail.trim(), receivedAt: f.receivedAt, notes: f.notes.trim(), assigneeId: f.assigneeId || null,
    })) onSaved();
  };
  return (
    <Modal open size="xl" onClose={onClose} title="Log a privacy request">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="They ask to">
            <select className="input" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value }))}>
              <option value="erasure">Erase their data</option><option value="access">Get a copy of their data</option>
            </select>
          </Field>
          <Field label="Under">
            <select className="input" value={f.regulation} onChange={(e) => setF((s) => ({ ...s, regulation: e.target.value }))}>
              {REGULATIONS.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.days} days</option>)}
            </select>
          </Field>
          <Field label="Received" hint={`Due ${reg.days} days later`}>
            <input type="date" className="input" required max={new Date().toISOString().slice(0, 10)} value={f.receivedAt} onChange={(e) => setF((s) => ({ ...s, receivedAt: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="The person is identified by">
            <select className="input" value={f.subjectType} onChange={(e) => setF((s) => ({ ...s, subjectType: e.target.value as SubjectType }))}>
              {SUBJECTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={subjectLabel(f.subjectType)}>
              <input className="input font-mono" required value={f.subject} placeholder={SUBJECTS.find((x) => x.value === f.subjectType)!.placeholder} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} />
            </Field>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Network" hint="Every network searches all of them">
            <select className="input" value={f.networkId} onChange={(e) => setF((s) => ({ ...s, networkId: e.target.value }))}>
              <option value="">Every network</option>
              {(networks.data ?? []).filter((n) => n.status !== 'deleted').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </Field>
          <Field label="Requester’s email" hint="Optional — where to answer">
            <input className="input" type="email" value={f.requesterEmail} onChange={(e) => setF((s) => ({ ...s, requesterEmail: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Owner"><StaffSelect staff={staff.data} value={f.assigneeId} onChange={(v) => setF((s) => ({ ...s, assigneeId: v }))} ariaLabel="Owner" /></Field>
          <Field label="Notes" hint="Optional"><input className="input" maxLength={5000} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !f.subject.trim()}>{m.busy ? 'Saving…' : 'Log request'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RequestDetail({ request: p, canEdit, onClose, onChanged }: {
  request: PrivacyRequest; canEdit: boolean; onClose: () => void; onChanged: (p: PrivacyRequest | null) => void;
}) {
  const confirm = useConfirm();
  const staff = useStaff();
  const [notes, setNotes] = useState(p.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = p.status === 'completed' || p.status === 'rejected';
  const patch = async (b: Record<string, unknown>) => {
    setError(null); setBusy(true);
    try { onChanged(await api.patch<PrivacyRequest>(`/platform/trust/privacy/${p.id}`, b)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };
  const where = p.network_name ? `in ${p.network_name}` : 'in every network';
  return (
    <Modal open size="xl" onClose={onClose} title={`Request #${p.number} · ${p.kind === 'erasure' ? 'erase data' : 'copy of data'}`}>
      <div className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-small sm:grid-cols-2">
          <div><dt className="text-tiny text-fg-muted">About</dt><dd className="text-fg">{subjectLabel(p.subject_type)} <span className="font-mono">{p.subject}</span></dd></div>
          <div><dt className="text-tiny text-fg-muted">Where</dt><dd className="text-fg">{p.network_name ?? 'Every network'}</dd></div>
          <div><dt className="text-tiny text-fg-muted">Regulation</dt><dd className="text-fg">{regulationLabel(p.regulation)} · received {day(p.received_at)}</dd></div>
          <div><dt className="text-tiny text-fg-muted">Due</dt><dd className={p.overdue ? 'font-medium text-danger-text' : 'text-fg'}>{day(p.due_at)} ({relTime(p.due_at)})</dd></div>
          <div><dt className="text-tiny text-fg-muted">Requester</dt><dd className="text-fg">{p.requester_email ?? '—'}</dd></div>
          <div><dt className="text-tiny text-fg-muted">Status</dt><dd><Chip className={PRIVACY_STATUS[p.status].chip}>{PRIVACY_STATUS[p.status].label}</Chip></dd></div>
        </dl>
        {p.result && (
          <div className="rounded-lg bg-success-bg px-4 py-3 text-small text-success-text">
            Erased: {p.result.clicks} click(s), {p.result.conversions} conversion(s)’ raw parameters, {p.result.inboundPostbacks + p.result.outboundPostbacks} postback log(s) in {p.result.networks} network(s). Amounts were kept.
          </div>
        )}
        {canEdit && !done && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Owner"><StaffSelect staff={staff.data} value={p.assignee_id ?? ''} onChange={(v) => void patch({ assigneeId: v || null })} ariaLabel="Owner" disabled={busy} /></Field>
            <Field label="Status">
              <select className="input" value={p.status} disabled={busy} onChange={(e) => void patch({ status: e.target.value })}>
                <option value="new">New</option><option value="in_progress">In progress</option>
              </select>
            </Field>
          </div>
        )}
        <Field label="Notes">
          <textarea className="input min-h-[80px]" value={notes} disabled={!canEdit || busy} onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (canEdit && notes !== (p.notes ?? '')) void patch({ notes }); }} />
        </Field>
        {canEdit && !done && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <button className="btn-ghost text-danger-text" disabled={busy} onClick={() => confirm({
              title: `Reject request #${p.number}?`, confirmLabel: 'Reject', destructive: true,
              message: 'Note why in the request first (e.g. the identity could not be verified). Its subject is masked once rejected.',
              onConfirm: async () => { await patch({ status: 'rejected' }); },
            })}>Reject</button>
            {p.kind === 'access' ? <>
              <button className="btn-ghost" disabled={busy} onClick={() => void api.download(`/platform/trust/privacy/${p.id}/export.csv`, `privacy-request-${p.number}.csv`).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not export'))}>
                Download their data (CSV)
              </button>
              <button className="btn-primary" disabled={busy} onClick={() => confirm({
                title: `Mark request #${p.number} completed?`, confirmLabel: 'Completed',
                message: 'Do it once the person has their copy — the subject is masked and can’t be exported again.',
                onConfirm: async () => { await patch({ status: 'completed' }); },
              })}>Mark completed</button>
            </> : (
              <button className="btn-primary" disabled={busy} onClick={() => confirm({
                title: `Erase this person’s data ${where}?`, confirmLabel: 'Erase now', destructive: true,
                message: `Clears the IP, user agent, referrer, city / region, ad click ids and sub ids of their clicks ${where}, the raw parameters of their conversions and the postback logs that carried them. Payouts, revenue and reports keep their numbers. This can’t be undone.`,
                onConfirm: async () => {
                  const r = await api.post<{ result: PrivacyRequest['result'] }>(`/platform/trust/privacy/${p.id}/erase`, {});
                  onChanged({ ...p, status: 'completed', result: r.result, completed_at: new Date().toISOString() });
                },
              })}>Erase now</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

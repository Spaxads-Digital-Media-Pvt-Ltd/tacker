/**
 * Super Admin › Trust & safety › Blocklist — what /click rejects for every network, ahead of each network's
 * own lists: IP addresses, CIDRs and ranges, user-agent phrases, referrer domains; optional expiry; how many
 * clicks each has stopped. Changes apply from the next click (api-backend lib/platform/blocklist.ts).
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { day } from '../../../lib/platformBilling';
import { BLOCK_KINDS, blockKindLabel, type BlockEntry, type BlockKind } from '../../../lib/platformTrust';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Segmented, Spinner, StateBlock, Table, type Column } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';

const KIND_CHIP: Record<BlockKind, string> = {
  ip: 'bg-info-bg text-info-text', user_agent: 'bg-warning-bg text-warning-text', referrer: 'bg-accent-subtle text-accent-text',
};

export default function Blocklist() {
  const canEdit = usePlatformMe().can('trust', 'full');
  const confirm = useConfirm();
  const [kind, setKind] = useState<'all' | BlockKind>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useQuery<BlockEntry[]>('/platform/trust/blocklist', { kind: kind === 'all' ? undefined : kind, q: q.trim() || undefined });

  const cols: Column<BlockEntry>[] = [
    { header: 'Kind', cell: (b) => <Chip className={KIND_CHIP[b.kind]}>{blockKindLabel(b.kind)}</Chip> },
    { header: 'Value', cell: (b) => <span className="font-mono text-small text-fg">{b.value}{b.value_to && b.value_to !== b.value ? ` – ${b.value_to}` : ''}</span> },
    { header: 'Reason', cell: (b) => b.reason ?? <span className="text-fg-muted">—</span> },
    { header: 'Blocked', cell: (b) => <span className={b.hits ? 'font-medium text-fg' : 'text-fg-muted'}>{b.hits.toLocaleString()} click(s)</span> },
    { header: 'Expires', cell: (b) => (b.expired ? <span className="text-fg-muted">expired {day(b.expires_at)}</span> : b.expires_at ? day(b.expires_at) : <span className="text-fg-muted">never</span>) },
    { header: 'Added', cell: (b) => <span className="text-tiny text-fg-secondary">{b.created_by_name ?? '—'} · {relTime(b.created_at)}</span> },
    ...(canEdit ? [{
      header: '', cell: (b: BlockEntry) => (
        <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => confirm({
          title: `Remove ${b.value} from the blocklist?`, confirmLabel: 'Remove', destructive: true,
          message: 'Its traffic reaches the networks again from the next click (their own lists still apply).',
          onConfirm: async () => { await api.del(`/platform/trust/blocklist/${b.id}`); list.refetch(); },
        })}>Remove</button>
      ),
    }] : []),
  ];

  return (
    <>
      <PageHeader title="Blocklist" subtitle="Blocked for every network — addresses, user agents and referrer domains."
        action={canEdit ? <button className="btn-primary" onClick={() => setAdding(true)}>Add to blocklist</button> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented className="sm:max-w-md" value={kind} onChange={(v) => setKind(v as typeof kind)}
          options={[{ value: 'all', label: 'All' }, { value: 'ip', label: 'IPs' }, { value: 'user_agent', label: 'User agents' }, { value: 'referrer', label: 'Referrers' }]} />
        <input className="input sm:max-w-xs" placeholder="Search value or reason…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the blocklist" />
      </div>
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock>
        : list.error ? <StateBlock>{list.error}</StateBlock>
        : (list.data ?? []).length === 0 ? <StateBlock>{q || kind !== 'all' ? 'Nothing matches.' : 'Nothing is blocked platform-wide. Block addresses from Trust & safety, or add one here.'}</StateBlock>
        : <Table columns={cols} rows={list.data!} rowKey={(b) => b.id} />}
      {adding && <AddBlock onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.refetch(); }} />}
    </>
  );
}

function AddBlock({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'ip' as BlockKind, value: '', to: '', reason: '', expires: '' });
  const m = useMutation((b: Record<string, unknown>) => api.post('/platform/trust/blocklist', b));
  const k = BLOCK_KINDS.find((x) => x.value === f.kind)!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { kind: f.kind, value: f.value.trim(), reason: f.reason.trim() };
    if (f.kind === 'ip' && f.to.trim()) body['valueTo'] = f.to.trim();
    if (f.expires) body['expiresAt'] = `${f.expires}T23:59:59Z`;
    if (await m.run(body)) onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Add to the platform blocklist">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <Field label="What to block">
          <select className="input" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as BlockKind, to: '' }))}>
            {BLOCK_KINDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </Field>
        <div className={`grid grid-cols-1 gap-3 ${f.kind === 'ip' ? 'sm:grid-cols-2' : ''}`}>
          <Field label={f.kind === 'ip' ? 'Address or CIDR' : k.label} hint={k.hint}>
            <input className="input font-mono" required autoFocus value={f.value} placeholder={k.placeholder} onChange={(e) => setF((s) => ({ ...s, value: e.target.value }))} />
          </Field>
          {f.kind === 'ip' && (
            <Field label="Range up to" hint="Optional — the last address of a range">
              <input className="input font-mono" value={f.to} placeholder="203.0.113.50" onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} />
            </Field>
          )}
        </div>
        <Field label="Reason" hint="Optional — your team sees it"><input className="input" maxLength={500} value={f.reason} onChange={(e) => setF((s) => ({ ...s, reason: e.target.value }))} /></Field>
        <Field label="Expires" hint="Optional — blocked until the end of this day (UTC)">
          <input type="date" className="input sm:max-w-[12rem]" min={new Date().toISOString().slice(0, 10)} value={f.expires} onChange={(e) => setF((s) => ({ ...s, expires: e.target.value }))} />
        </Field>
        <p className="text-tiny text-fg-muted">Applies to every network from the next click — rejected clicks are still recorded, as “Blocked platform-wide”.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !f.value.trim()}>{m.busy ? 'Adding…' : 'Block it'}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Investigator — Manage Investigations. Real saved lookups against clicks/conversions by sub ID,
 * transaction ID, click ID, or partner within a date range.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import { daysAgo, todayStr } from '../../components/ReportPageKit';
import type { Publisher } from '../../types';

interface Investigation {
  id: string; ref: number; startDate: string; endDate: string;
  targetType: string; target: string;
  entryCount: number; suspectCount: number; offerCount: number; partnerCount: number;
  fileName: string | null; createdAt: string;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString();
}

function AddInvestigationModal({
  open, onClose, onCreated, publishers,
}: {
  open: boolean; onClose: () => void; onCreated: () => void; publishers: Publisher[];
}) {
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(todayStr());
  const [targetType, setTargetType] = useState<'sub_id' | 'transaction_id' | 'click_id' | 'partner'>('sub_id');
  const [subField, setSubField] = useState<'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5'>('sub1');
  const [targetValue, setTargetValue] = useState('');
  const [publisherId, setPublisherId] = useState('');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/investigator', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { startDate, endDate, targetType };
    if (targetType === 'partner') body.publisherId = publisherId;
    else if (targetType === 'sub_id') { body.subField = subField; body.targetValue = targetValue.trim(); }
    else body.targetValue = targetValue.trim();
    if (await run(body)) onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="New investigation">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <input type="date" className="input" required value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date">
            <input type="date" className="input" required value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Target type">
          <select className="input" value={targetType} onChange={(e) => setTargetType(e.target.value as typeof targetType)}>
            <option value="sub_id">Sub ID</option>
            <option value="transaction_id">Transaction ID</option>
            <option value="click_id">Click ID</option>
            <option value="partner">Partner</option>
          </select>
        </Field>
        {targetType === 'sub_id' && (
          <Field label="Sub field">
            <select className="input" value={subField} onChange={(e) => setSubField(e.target.value as typeof subField)}>
              {(['sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
        {targetType === 'partner' ? (
          <Field label="Partner">
            <select className="input" required value={publisherId} onChange={(e) => setPublisherId(e.target.value)}>
              <option value="" disabled>Select partner…</option>
              {publishers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (#{p.ref})</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={targetType === 'click_id' ? 'Click ID' : targetType === 'transaction_id' ? 'Transaction ID' : 'Sub ID value'}>
            <input className="input" required value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder="Enter value to investigate…" />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Running…' : 'Run investigation'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteInvestigationModal({
  open, investigation, onClose, onConfirm, busy, error,
}: {
  open: boolean;
  investigation: Investigation | null;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
}) {
  if (!investigation) return null;
  return (
    <Modal open={open} onClose={onClose} title="Delete investigation">
      <p className="text-small text-fg-secondary">
        Are you sure you want to delete investigation{' '}
        <span className="font-semibold text-fg">#{investigation.ref}</span>
        {' '}({investigation.target})? This action cannot be undone.
      </p>
      {error && <p className="mt-3 text-small text-danger-text">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="rounded-[var(--radius)] bg-danger px-4 py-2 text-small font-medium text-white hover:opacity-90 disabled:opacity-50"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}

export default function Investigator() {
  const { data, loading, refetch } = useQuery<Investigation[]>('/api/investigator');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { run: runDelete, busy: deleting, error: deleteError } = useMutation((id: string) => api.del(`/api/investigator/${id}`));
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Investigation | null>(null);
  const [q, setQ] = useState('');

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    if (await runDelete(pendingDelete.id)) {
      setPendingDelete(null);
      refetch();
    }
  };

  const rows = useMemo(() => {
    const list = data ?? [];
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter((r) =>
      String(r.ref).includes(needle) ||
      r.target.toLowerCase().includes(needle) ||
      fmtDate(r.startDate).includes(needle) ||
      fmtDate(r.endDate).includes(needle),
    );
  }, [data, q]);

  const columns: Column<Investigation>[] = [
    { header: 'ID', cell: (r) => <Link to={`/app/investigator/${r.id}`} className="tabular-nums text-accent-text hover:underline">{r.ref}</Link> },
    { header: 'Start Date', cell: (r) => fmtDate(r.startDate) },
    { header: 'End Date', cell: (r) => fmtDate(r.endDate) },
    { header: 'Target', cell: (r) => <span className="text-fg-secondary">{r.target}</span> },
    { header: 'Entries', cell: (r) => r.entryCount.toLocaleString() },
    { header: 'Suspects', cell: (r) => r.suspectCount.toLocaleString() },
    { header: 'Offers', cell: (r) => r.offerCount.toLocaleString() },
    { header: 'Partners', cell: (r) => r.partnerCount.toLocaleString() },
    { header: 'File', cell: (r) => r.fileName ?? '—' },
    { header: 'Investigation Date', cell: (r) => fmtDate(r.createdAt) },
    {
      header: '',
      cell: (r) => (
        <button
          type="button"
          className="text-tiny text-danger-text hover:underline"
          onClick={() => setPendingDelete(r)}
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Manage Investigations" subtitle="Investigator" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>+ Investigation</button>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !w-56 !pl-8" />
        </div>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : rows.length === 0 ? <StateBlock>No investigations yet. Create one to search clicks and conversions.</StateBlock>
        : <Table columns={columns} rows={rows} rowKey={(r) => r.id} />}
      <AddInvestigationModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={() => { setAdding(false); refetch(); }}
        publishers={publishers ?? []}
      />
      <DeleteInvestigationModal
        open={pendingDelete != null}
        investigation={pendingDelete}
        onClose={() => !deleting && setPendingDelete(null)}
        onConfirm={confirmDelete}
        busy={deleting}
        error={deleteError}
      />
    </>
  );
}

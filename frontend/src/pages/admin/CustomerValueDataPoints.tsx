/**
 * Customer Value › Custom Data Points — the named variables (e.g. "Deposit", "GEO") that Payout
 * & Revenue Rules build conditions against. Each reads a specific key out of a conversion's
 * `raw_params` (already captured verbatim from postback/pixel/S2S query+body params — see
 * surfaces/tracking/app.ts). Real CRUD; genuinely consumed by lib/customer-value/evaluate.ts.
 *
 * The reference's own live Custom Data Points page isn't reachable on the public demo account
 * (Customer Value is a gated module there — confirmed via the account's in-app search, which
 * indexes it only as a Help Article, and a direct URL renders blank). Structured to match every
 * other real "Manage X" list this session verified directly against the reference (Search, a
 * Table Actions kebab with Columns Customization, a Pagination footer, a numeric ref-based ID
 * column) — the same conventions already confirmed on Payout & Revenue Rules, Tiered Commissions,
 * and others — rather than guessing at a page that can't be inspected live.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, Search, MoreVertical, ChevronDown } from 'lucide-react';
import { PageHeader, Field, Modal, Spinner, StateBlock } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { ColumnsModal } from '../../components/TableActionsKit';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';

interface DataPoint { id: string; ref: number; name: string; dataType: 'text' | 'number'; parameterKey: string; createdAt: string; updatedAt: string }

const ALL_COLUMNS = ['ID', 'Name', 'Data Type', 'Parameter Name', 'Created', 'Modified'] as const;
const PAGE_SIZE = 25;
const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
] as const;

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return { open, setOpen, ref };
}

function TypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const current = TYPE_OPTIONS.find((o) => o.value === value) ?? TYPE_OPTIONS[0];
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)}>
        {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {TYPE_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {o.label}
              {o.value === value && <span className="ml-auto text-accent-text">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DataPointForm({ initial, onSaved, onCancel }: { initial?: DataPoint; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [dataType, setDataType] = useState<'text' | 'number'>(initial?.dataType ?? 'text');
  const [parameterKey, setParameterKey] = useState(initial?.parameterKey ?? '');
  const { run, busy, error } = useMutation((body: { name: string; dataType: string; parameterKey: string }) =>
    initial ? api.patch(`/api/customer-value/data-points/${initial.id}`, body) : api.post('/api/customer-value/data-points', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run({ name, dataType, parameterKey })) onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div>
        <label className="label mb-2 block">Data Type *</label>
        <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
          {(['text', 'number'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setDataType(t)}
              className={`flex-1 py-2 text-small font-medium capitalize ${dataType === t ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
              {t === 'text' ? 'Text' : 'Number'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-tiny text-fg-muted">
          {dataType === 'text' ? 'Text data points give condition operators like "is an exact match".' : 'Number data points give condition operators like "is greater than".'}
        </p>
      </div>
      <Field label="Parameter Name *">
        <input className="input font-mono" required value={parameterKey} placeholder="e.g. deposit"
          onChange={(e) => setParameterKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
        <p className="mt-1 text-tiny text-fg-muted">The postback/conversion parameter this reads, e.g. …&{parameterKey || 'deposit'}=150</p>
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function CustomerValueDataPoints() {
  const { data, loading, refetch } = useQuery<DataPoint[]>('/api/customer-value/data-points');
  const [editing, setEditing] = useState<DataPoint | null | 'new'>(null);
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/customer-value/data-points/${id}`));

  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) setTableActionsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (type !== 'all') rows = rows.filter((d) => d.dataType === type);
    if (q.trim()) { const qq = q.trim().toLowerCase(); rows = rows.filter((d) => d.name.toLowerCase().includes(qq) || d.parameterKey.toLowerCase().includes(qq)); }
    return rows;
  }, [data, q, type]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const orderedShown = useMemo(() => columnOrder.filter((c) => shownColumns.has(c)), [columnOrder, shownColumns]);

  const cellFor = (header: string, d: DataPoint): React.ReactNode => {
    switch (header) {
      case 'ID': return <span className="tabular-nums text-fg-secondary">{d.ref}</span>;
      case 'Name': return <span className="font-medium text-fg">{d.name}</span>;
      case 'Data Type': return <span className="capitalize">{d.dataType}</span>;
      case 'Parameter Name': return <span className="font-mono text-fg-secondary">{d.parameterKey}</span>;
      case 'Created': return new Date(d.createdAt).toLocaleString();
      case 'Modified': return new Date(d.updatedAt).toLocaleString();
      default: return null;
    }
  };

  return (
    <>
      <PageHeader title="Manage Custom Data Points" subtitle="Customer Value › Custom Data Points"
        action={<button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing('new')}><Plus size={14} /> Data Point</button>} />

      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-56 !pl-8" placeholder="Search by name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <TypeSelect value={type} onChange={(v) => { setType(v); setPage(1); }} />
        <div ref={tableActionsRef} className="relative">
          <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
          {tableActionsOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
              <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
              <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
            </div>
          )}
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock> : filtered.length === 0 ? (
        <StateBlock>No Record Found</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny text-fg-secondary">
              <tr>
                {orderedShown.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left">{h}</th>)}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {paged.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  {orderedShown.map((h) => <td key={h} className="whitespace-nowrap px-3 py-2 text-fg">{cellFor(h, d)}</td>)}
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button title="Edit" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={() => setEditing(d)}><Pencil size={14} /></button>
                      <button title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text"
                        onClick={async () => { if (confirm(`Delete data point "${d.name}"?`) && (await runDelete(d.id))) refetch(); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>

      {showColumns && (
        <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns}
          onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Data Point' : 'Edit Data Point'}>
        <DataPointForm initial={editing && editing !== 'new' ? editing : undefined} onSaved={() => { setEditing(null); refetch(); }} onCancel={() => setEditing(null)} />
      </Modal>
    </>
  );
}

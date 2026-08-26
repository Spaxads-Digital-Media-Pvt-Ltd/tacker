/**
 * Reporting › Custom Reporting Metrics — verified against the live reference (URL
 * `/reporting/metrics`, "Manage Custom Metrics", 4 real rows: ID | Name | Formula | Format | Created
 * | Modified, each formula built from real base-metric chips like `Clicks / CV` or
 * `(Invalid clicks / Gross Clicks) x 100`). Real CRUD, not a shell: `custom_metrics` table +
 * `/api/custom-metrics` (api-backend/src/surfaces/dashboard/custom-metrics/routes.ts), formulas
 * validated server-side against the same whitelisted base-metric keys the client offers.
 *
 * Notable finding from the reference while researching this page: its own "cc" custom metric —
 * which has shown up as an honest "—" (no real backing) on every other report built this session
 * (Partner/Hourly Report's "CC" column) — turns out to be user-defined here as `Clicks / CV`. That's
 * not a built-in reference metric at all; it's this demo account's own custom metric. Wiring
 * defined-here metrics into other reports' column pickers is a separate, larger cross-cutting change
 * this page doesn't attempt — it only builds real management of the definitions themselves.
 *
 * Formulas are evaluated client-side (components/../lib/customMetrics.ts) via a closed-token
 * shunting-yard evaluator, never `eval()`/`Function()` of user input.
 */
import { useState } from 'react';
import { MoreVertical, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, Modal } from '../../components/ui';
import {
  METRIC_KEYS, METRIC_LABELS, OPERATORS, FORMAT_LABELS,
  type FormulaToken, type MetricFormat, tokenLabel,
} from '../../lib/customMetrics';

interface CustomMetric { id: string; ref: number; name: string; formula: FormulaToken[]; format: MetricFormat; createdAt: string; updatedAt: string }

function TokenChip({ t }: { t: FormulaToken }) {
  if (t.type === 'op') return <span className="px-0.5 text-fg-secondary">{tokenLabel(t)}</span>;
  return <span className="inline-block rounded-[var(--radius)] border border-dashed border-border px-1.5 py-0.5 text-tiny text-fg">{tokenLabel(t)}</span>;
}

function FormulaBuilder({ tokens, onChange }: { tokens: FormulaToken[]; onChange: (t: FormulaToken[]) => void }) {
  const [constVal, setConstVal] = useState('');
  const push = (t: FormulaToken) => onChange([...tokens, t]);
  const undo = () => onChange(tokens.slice(0, -1));

  return (
    <div className="space-y-3">
      <div>
        <label className="label mb-1 block">Formula</label>
        <div className="flex min-h-[42px] flex-wrap items-center gap-1 rounded-[var(--radius)] border border-border bg-page px-3 py-2">
          {tokens.length === 0 ? <span className="text-small text-fg-muted">Click metrics and operators below to build a formula…</span>
            : tokens.map((t, i) => <TokenChip key={i} t={t} />)}
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-40" disabled={!tokens.length} onClick={undo}>Undo last</button>
          <button type="button" className="text-tiny font-medium text-danger-text hover:underline disabled:cursor-not-allowed disabled:opacity-40" disabled={!tokens.length} onClick={() => onChange([])}>Clear</button>
        </div>
      </div>

      <div>
        <label className="label mb-1 block">Metrics</label>
        <div className="flex flex-wrap gap-1.5">
          {METRIC_KEYS.map((k) => (
            <button key={k} type="button" onClick={() => push({ type: 'metric', key: k })}
              className="rounded-[var(--radius)] border border-border bg-surface px-2.5 py-1 text-tiny text-fg hover:bg-accent-subtle">
              {METRIC_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label mb-1 block">Operators</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {OPERATORS.map((o) => (
            <button key={o.value} type="button" onClick={() => push({ type: 'op', value: o.value })}
              className="grid h-8 w-8 place-items-center rounded-[var(--radius)] border border-border bg-surface text-small font-medium text-fg hover:bg-accent-subtle">
              {o.label}
            </button>
          ))}
          <div className="ml-2 flex items-center gap-1.5">
            <input type="number" className="input !w-24" placeholder="Number" value={constVal} onChange={(e) => setConstVal(e.target.value)} />
            <button type="button" disabled={constVal.trim() === '' || Number.isNaN(Number(constVal))}
              onClick={() => { push({ type: 'const', value: Number(constVal) }); setConstVal(''); }}
              className="btn-ghost !py-1.5 !px-3 text-tiny disabled:cursor-not-allowed disabled:opacity-40">Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricModal({ initial, onClose, onSaved }: { initial: CustomMetric | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [format, setFormat] = useState<MetricFormat>(initial?.format ?? 'number');
  const [tokens, setTokens] = useState<FormulaToken[]>(initial?.formula ?? []);
  const save = useMutation((body: Record<string, unknown>) =>
    initial ? api.patch(`/api/custom-metrics/${initial.id}`, body) : api.post('/api/custom-metrics', body));

  const submit = async () => {
    if (!name.trim() || tokens.length === 0) return;
    if (await save.run({ name: name.trim(), format, formula: tokens })) { onSaved(); onClose(); }
  };

  return (
    <Modal open onClose={onClose} title={initial ? 'Edit Custom Metric' : 'Add Custom Metric'} size="xl">
      <div className="space-y-4">
        <div>
          <label className="label mb-1 block">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Click to Event rate" />
        </div>
        <div>
          <label className="label mb-1 block">Format</label>
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as MetricFormat)}>
            {(Object.keys(FORMAT_LABELS) as MetricFormat[]).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>
        </div>
        <FormulaBuilder tokens={tokens} onChange={setTokens} />
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={save.busy || !name.trim() || !tokens.length} onClick={submit}>
            {save.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RowMenu({ metric, onEdit, onDeleted }: { metric: CustomMetric; onEdit: () => void; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const del = useMutation((id: string) => api.del(`/api/custom-metrics/${id}`));
  return (
    <div className="relative">
      <button type="button" title="Actions" onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { setOpen(false); onEdit(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Edit</button>
          <button onClick={async () => { if (confirm(`Delete metric "${metric.name}"?`)) { setOpen(false); if (await del.run(metric.id)) onDeleted(); } }}
            className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-accent-subtle">Delete</button>
        </div>
      )}
    </div>
  );
}

export default function CustomMetricsManage() {
  const { data, loading, error, refetch } = useQuery<CustomMetric[]>('/api/custom-metrics');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<'add' | CustomMetric | null>(null);

  const rows = (data ?? []).filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader title="Manage Custom Metrics" subtitle="Reporting › Custom Reporting Metrics" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setModal('add')} className="btn-primary flex items-center gap-1.5">
          <Plus size={15} /> Add Custom Metric
        </button>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !rows.length ? <StateBlock>{q.trim() ? 'No Record Found' : 'No custom metrics yet — add one above.'}</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">ID</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Name</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Formula</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Format</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Created</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Modified</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((m) => (
                    <tr key={m.id} className="hover:bg-accent-subtle/40">
                      <td className="px-4 py-3 text-fg-secondary">{m.ref}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-fg">{m.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {m.formula.map((t, i) => <TokenChip key={i} t={t} />)}
                        </div>
                      </td>
                      <td className="px-4 py-3">{FORMAT_LABELS[m.format]}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small text-fg-secondary">{new Date(m.createdAt).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-small text-fg-secondary">{new Date(m.updatedAt).toLocaleString()}</td>
                      <td className="text-right"><RowMenu metric={m} onEdit={() => setModal(m)} onDeleted={refetch} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="mt-2 flex items-center justify-end gap-2 text-tiny text-fg-muted">
          <span>{rows.length} Total</span>
        </div>
      </div>

      {modal && (
        <MetricModal
          initial={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={refetch}
        />
      )}
    </>
  );
}

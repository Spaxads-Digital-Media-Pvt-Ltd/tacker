/**
 * Super Admin › Sales › Leads — every prospective network: search (company, contact, email, website), filter
 * by stage / owner / source, sort, page; add one; CSV of what's filtered.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useDebounced } from '../../admin/pagedList';
import { money } from '../../../lib/platformBilling';
import { relTime, isOverdue } from '../../../lib/relativeTime';
import { STAGES, SOURCES, sourceLabel, totalOf, useStaff, type Lead } from '../../../lib/platformSales';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { Avatar, Pager } from '../kit';
import { StageChip } from './parts';
import { LeadForm } from './LeadForm';

const LIMIT = 50;

export default function Leads() {
  const { can } = usePlatformMe();
  const canEdit = can('sales', 'full');
  const staff = useStaff();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('open');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState('updated');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const search = useDebounced(q.trim(), 300);
  const filters = { q: search || undefined, stage, owner: owner || undefined, source: source || undefined, sort };
  const leads = useQuery<Lead[]>('/platform/sales/leads', { ...filters, limit: LIMIT, offset });
  const setFilter = (fn: () => void) => { fn(); setOffset(0); };

  const exportCsv = async () => {
    setExportError(null);
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
    try { await api.download(`/platform/sales/leads.csv?${qs}`, `leads-${new Date().toISOString().slice(0, 10)}.csv`); }
    catch (e) { setExportError(e instanceof Error ? e.message : 'Export failed'); }
  };

  const columns: Column<Lead>[] = [
    {
      header: 'Company', cell: (l) => (
        <div className="min-w-[12rem]">
          <Link to={`/admin/sales/leads/${l.id}`} className="font-medium text-fg hover:text-accent-text hover:underline">{l.company}</Link>
          <p className="text-tiny text-fg-muted">{[l.contact_name, l.email].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { header: 'Stage', cell: (l) => <StageChip stage={l.stage} /> },
    { header: 'Owner', cell: (l) => (l.owner_name ? <span className="inline-flex items-center gap-2"><Avatar name={l.owner_name} size="sm" />{l.owner_name}</span> : <span className="text-fg-muted">Unassigned</span>) },
    { header: 'Value / mo', className: 'text-right', cell: (l) => (l.expected_mrr ? money(l.expected_mrr, l.currency) : <span className="text-fg-muted">—</span>) },
    {
      header: 'Next step', cell: (l) => (l.next_step || l.next_step_at
        ? <div className="max-w-[16rem]"><p className="truncate">{l.next_step ?? '—'}</p>{l.next_step_at && <p className={`text-tiny ${isOverdue(l.next_step_at) && l.stage !== 'won' && l.stage !== 'lost' ? 'font-medium text-danger-text' : 'text-fg-muted'}`}>{relTime(l.next_step_at)}</p>}</div>
        : <span className="text-fg-muted">—</span>),
    },
    { header: 'Source', cell: (l) => <span className="text-fg-secondary">{sourceLabel(l.source)}</span> },
    { header: 'Updated', cell: (l) => <span className="text-fg-secondary" title={new Date(l.updated_at).toLocaleString()}>{relTime(l.updated_at)}</span> },
  ];

  return (
    <>
      <PageHeader title="Leads" subtitle="Prospective networks — from the first contact to a signed customer."
        action={<>
          <button className="btn-ghost" onClick={() => void exportCsv()}>Export CSV</button>
          {canEdit && <button className="btn-primary" onClick={() => setAdding(true)}>New lead</button>}
        </>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search company, contact, email or website…" value={q} onChange={(e) => setFilter(() => setQ(e.target.value))} />
        <select className="input !w-auto" value={stage} onChange={(e) => setFilter(() => setStage(e.target.value))} aria-label="Stage">
          <option value="open">Open deals</option>
          <option value="all">Every stage</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="input !w-auto" value={owner} onChange={(e) => setFilter(() => setOwner(e.target.value))} aria-label="Owner">
          <option value="">Any owner</option>
          <option value="me">Mine</option>
          <option value="unassigned">Unassigned</option>
          {(staff.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
        </select>
        <select className="input !w-auto" value={source} onChange={(e) => setFilter(() => setSource(e.target.value))} aria-label="Source">
          <option value="">Any source</option>
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className="input !w-auto" value={sort} onChange={(e) => setFilter(() => setSort(e.target.value))} aria-label="Sort">
          <option value="updated">Recently updated</option>
          <option value="created">Newest</option>
          <option value="next_step">Next step due</option>
          <option value="value">Highest value</option>
          <option value="company">Company A–Z</option>
        </select>
      </div>
      {exportError && <p className="mb-3 text-small text-danger-text">{exportError}</p>}
      {leads.loading && !leads.data ? <StateBlock><Spinner /></StateBlock>
        : leads.error ? <StateBlock>{leads.error}</StateBlock>
        : (leads.data ?? []).length === 0 ? (
          <StateBlock>
            {search || stage !== 'open' || owner || source ? 'No lead matches these filters.' : <>No open leads yet.{canEdit && <> <button className="font-medium text-accent-text hover:underline" onClick={() => setAdding(true)}>Add the first one</button>.</>}</>}
          </StateBlock>
        )
        : <>
          <Table columns={columns} rows={leads.data ?? []} rowKey={(l) => l.id} />
          <Pager offset={offset} limit={LIMIT} total={totalOf(leads.data)} onChange={setOffset} />
        </>}
      {adding && <LeadForm lead={null} onClose={() => setAdding(false)} onSaved={(l) => { setAdding(false); navigate(`/admin/sales/leads/${l.id}`); }} />}
    </>
  );
}

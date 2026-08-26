/**
 * Control Center › Accounts — real data on both sub-tabs. Accounts reads the same `/api/users`
 * table already used to populate Partner/Account Manager pickers elsewhere (Manage Partners, etc.)
 * — real team-member rows, though this app has no dedicated fields for Business Unit, Partner/
 * Advertiser Manager flags, Primary Phone, Title, or Super User, so those render as "—" rather than
 * fabricated. History Log reads the real `audit_log` table (GET /api/audit-log) — every mutating
 * admin action in this app already writes there via writeAudit(); this is the un-filtered,
 * network-wide feed, same real data other pages already show a per-entity slice of. Toolbar (date
 * range, Service filter, search, Table Actions) and the green "NEW!" badge match the reference's
 * own real History Log, confirmed against a pasted screenshot.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Search, Filter, MoreVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { Tabs, Badge, Spinner, StateBlock } from '../../../components/ui';
import { ColumnsModal } from '../../../components/TableActionsKit';
import { Pagination, daysAgo, todayStr, toIso, DASH } from '../../../components/ReportPageKit';
import { downloadCsv, downloadXlsx } from '../../../lib/export';
import { useQuery } from '../../../lib/useApi';
import type { DashboardUser } from '../../../types';

const ACCOUNT_COLUMNS = [
  'Name', 'Business Unit', 'Email', 'Role', 'Partner Manager', 'Advertiser Manager',
  'Primary Phone', 'Title', 'Super User', 'Created', 'Modified',
];
const HISTORY_COLUMNS = ['ID', 'Operation Time', 'Service', 'Changes', 'Employee', 'Method', 'Portal', 'User IP', 'User Agent'];
const PAGE_SIZE = 25;

interface HistoryRow {
  id: string; ref: number; operationTime: string; service: string; changes: string; isNew: boolean;
  employee: string; method: string; portal: string; userIp: string | null; userAgent: string | null;
}

function AccountsList() {
  const { data, loading, error } = useQuery<DashboardUser[]>('/api/users');
  const rows = data ?? [];
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button title="Not available yet" className="btn-primary">+ Add Account</button>
      </div>
      {rows.length === 0 ? <StateBlock>No accounts found.</StateBlock> : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[1100px] text-left text-body">
            <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
              <tr>{ACCOUNT_COLUMNS.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((u) => (
                <tr key={u.id} className="bg-surface text-fg hover:bg-accent-subtle/40">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-accent-text">{u.name}</td>
                  <td className="px-4 py-3 text-fg-muted">—</td>
                  <td className="whitespace-nowrap px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3"><Badge value={u.role} /></td>
                  <td className="px-4 py-3 text-fg-muted">—</td>
                  <td className="px-4 py-3 text-fg-muted">—</td>
                  <td className="px-4 py-3 text-fg-muted">—</td>
                  <td className="px-4 py-3 text-fg-muted">—</td>
                  <td className="px-4 py-3 text-fg-muted">—</td>
                  <td className="whitespace-nowrap px-4 py-3">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="whitespace-nowrap px-4 py-3">{new Date(u.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 text-tiny text-fg-secondary">{rows.length} Total</div>
    </div>
  );
}

function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);
  return ref;
}

function DateRangeChip({ from, to, onApply }: { from: string; to: string; onApply: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const ref = useOutsideClose(open, () => setOpen(false));
  const fmt = (d: string) => { const dt = new Date(d); return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`; };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => { setDraftFrom(from); setDraftTo(to); setOpen((o) => !o); }}
        className="input flex !w-auto items-center gap-2 !py-1.5">
        <Calendar size={14} className="text-fg-muted" />{fmt(from)} - {fmt(to)}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 space-y-3 rounded-card border border-border bg-elevated p-3 shadow-elevated">
          <div>
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={draftFrom} max={draftTo} onChange={(e) => setDraftFrom(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={draftTo} min={draftFrom} max={todayStr()} onChange={(e) => setDraftTo(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost !py-1 !px-3 text-tiny" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary !py-1 !px-3 text-tiny" onClick={() => { onApply(draftFrom, draftTo); setOpen(false); }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceSelect({ services, value, onChange }: { services: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex !w-auto items-center gap-1.5">
        {value || 'Service'} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
          <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">All Services</button>
          {services.map((s) => (
            <button key={s} type="button" onClick={() => { onChange(s); setOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function MoreFiltersButton({ portal, method, onApply }: { portal: string; method: string; onApply: (portal: string, method: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draftPortal, setDraftPortal] = useState(portal);
  const [draftMethod, setDraftMethod] = useState(method);
  const ref = useOutsideClose(open, () => setOpen(false));
  const count = (portal ? 1 : 0) + (method ? 1 : 0);
  return (
    <div ref={ref} className="relative">
      <button type="button" title="Filters" onClick={() => { setDraftPortal(portal); setDraftMethod(method); setOpen((o) => !o); }}
        className="relative grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <Filter size={15} />
        {count > 0 && <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 space-y-3 rounded-card border border-border bg-elevated p-3 shadow-elevated">
          <div>
            <label className="label mb-1 block">Portal</label>
            <select className="input" value={draftPortal} onChange={(e) => setDraftPortal(e.target.value)}>
              <option value="">All</option>
              <option value="Dashboard">Dashboard</option>
              <option value="API">API</option>
              <option value="System">System</option>
              <option value="Platform Admin">Platform Admin</option>
            </select>
          </div>
          <div>
            <label className="label mb-1 block">Method</label>
            <select className="input" value={draftMethod} onChange={(e) => setDraftMethod(e.target.value)}>
              <option value="">All</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="Scheduled Action">Scheduled Action</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost !py-1 !px-3 text-tiny" onClick={() => { onApply('', ''); setOpen(false); }}>Clear</button>
            <button type="button" className="btn-primary !py-1 !px-3 text-tiny" onClick={() => { onApply(draftPortal, draftMethod); setOpen(false); }}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryLog() {
  const [from, setFrom] = useState(daysAgo(56));
  const [to, setTo] = useState(todayStr());
  const [q, setQ] = useState('');
  const [service, setService] = useState('');
  const [portal, setPortal] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...HISTORY_COLUMNS]);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const tableActionsRef = useOutsideClose(tableActionsOpen, () => { setTableActionsOpen(false); setExportOpen(false); });

  const qs = `from=${toIso(from)}&to=${toIso(to, true)}`;
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/audit-log?${qs}`);
  const allRows = data ?? [];

  const services = useMemo(() => [...new Set(allRows.map((r) => r.service))].sort(), [allRows]);
  const filtered = useMemo(() => allRows.filter((r) => {
    if (service && r.service !== service) return false;
    if (portal && r.portal !== portal) return false;
    if (method && r.method !== method) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      if (![r.employee, r.service, r.changes, r.userIp ?? ''].some((v) => v.toLowerCase().includes(needle))) return false;
    }
    return true;
  }), [allRows, service, portal, method, q]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const shown = useMemo(() => new Set(HISTORY_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const orderedShown = useMemo(() => columnOrder.filter((c) => shown.has(c)), [columnOrder, shown]);
  const exportRows = () => filtered.map((r) => ({
    id: r.ref, operationTime: r.operationTime, service: r.service, changes: r.changes,
    employee: r.employee, method: r.method, portal: r.portal, userIp: r.userIp ?? DASH, userAgent: r.userAgent ?? DASH,
  }));

  const cellFor = (header: string, r: HistoryRow) => {
    switch (header) {
      case 'ID': return <span className="tabular-nums text-fg-secondary">{r.ref}</span>;
      case 'Operation Time': {
        const d = new Date(r.operationTime);
        return (
          <div className="leading-tight">
            <div>{d.toLocaleDateString()}</div>
            <div className="text-tiny text-fg-secondary">{d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
          </div>
        );
      }
      case 'Service': return r.service;
      case 'Changes': return (
        <span className="flex items-center gap-2">
          {r.changes}
          {r.isNew && <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold uppercase text-white">New!</span>}
        </span>
      );
      case 'Employee': return r.employee;
      case 'Method': return r.method;
      case 'Portal': return r.portal;
      case 'User IP': return r.userIp ?? DASH;
      case 'User Agent': return <span className="max-w-xs truncate text-tiny text-fg-secondary" title={r.userAgent ?? undefined}>{r.userAgent ?? DASH}</span>;
      default: return null;
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <DateRangeChip from={from} to={to} onApply={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
        <div className="flex flex-wrap items-center gap-2">
          <ServiceSelect services={services} value={service} onChange={(v) => { setService(v); setPage(1); }} />
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <MoreFiltersButton portal={portal} method={method} onApply={(p, m) => { setPortal(p); setMethod(m); setPage(1); }} />
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
                  <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button onClick={() => { downloadCsv('history-log.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                      <button onClick={() => { downloadXlsx('history-log.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : filtered.length === 0 ? <StateBlock>No activity recorded in this period.</StateBlock>
        : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[1200px] text-left text-body">
              <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                <tr>{orderedShown.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((r) => (
                  <tr key={r.id} className="bg-surface text-fg hover:bg-accent-subtle/40">
                    {orderedShown.map((c) => <td key={c} className="whitespace-nowrap px-4 py-3">{cellFor(c, r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <div className="mt-3"><Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>

      {showColumns && (
        <ColumnsModal allColumns={HISTORY_COLUMNS} order={columnOrder} hidden={hiddenColumns}
          onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />
      )}
    </div>
  );
}

export default function AccountsTab() {
  const [sub, setSub] = useState('Accounts');
  return (
    <>
      <Tabs tabs={['Accounts', 'History Log']} active={sub} onChange={setSub} />
      {sub === 'Accounts' ? <AccountsList /> : <HistoryLog />}
    </>
  );
}

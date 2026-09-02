/**
 * Partners › Traffic Sources › Manage — verified item-by-item against the live reference. Each
 * traffic source is a reusable preset of tracking-link query Parameter/Value pairs (values often
 * containing macros like {sub1}) a Partner picks when generating a link, plus an optional
 * postback URL. No status/Active filter here — the reference doesn't have one for this page.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, MenuPopover, MenuItem, type Column } from '../../components/ui';
import { ColumnsModal } from '../../components/TableActionsKit';
import { downloadCsv, downloadXlsx } from '../../lib/export';
import type { TrafficSource } from '../../types';

const ALL_COLUMNS = ['ID', 'Name', 'URL', 'Tracking Link Parameters', 'Created', 'Modified'] as const;

function RowMenu({ source, onDeleted }: { source: TrafficSource; onDeleted: () => void }) {
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/traffic-sources/${source.id}`));
  const doDelete = async () => {
    if (!confirm(`Delete traffic source "${source.name}"?`)) return;
    if (await del.run(undefined)) onDeleted();
  };
  return (
    <MenuPopover
      ariaLabel="Traffic source actions" align="end" width="w-36"
      triggerClassName="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
    >
      {({ close }) => (
        <>
          <MenuItem onSelect={() => { close(); nav(`/app/aff-traffic-sources/${source.id}/edit`); }}>Edit</MenuItem>
          <MenuItem tone="danger" onSelect={() => { close(); void doDelete(); }}>Delete</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

function SourcesTableActions({ rows, onColumns }: { rows: TrafficSource[]; onColumns: () => void }) {
  const [subOpen, setSubOpen] = useState(false);
  const exportRows = () => rows.map((r) => ({
    ID: r.id.slice(0, 8), Name: r.name,
    'Postback URL': r.enablePostback && r.postbackUrl ? r.postbackUrl : '',
    'Tracking Link Parameters': r.trackingLinkParameters,
    'Visible to Partners': r.visibleToPartners ? 'YES' : 'NO',
    Created: r.createdAt, Modified: r.updatedAt,
  }));
  return (
    <MenuPopover
      ariaLabel="Table Actions" align="end" width="w-56"
      triggerClassName="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg"
      button={<MoreVertical size={15} />}
      onOpenChange={(o) => { if (!o) setSubOpen(false); }}
    >
      {({ close }) => (
        <>
          <div className="relative">
            <button type="button" onClick={() => setSubOpen((o) => !o)}
              className="flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-page">
              Export <ChevronRight size={13} className="text-fg-muted" />
            </button>
            {subOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <MenuItem onSelect={() => { downloadCsv('traffic-sources.csv', exportRows()); close(); }}>CSV</MenuItem>
                <MenuItem onSelect={() => { void downloadXlsx('traffic-sources.xlsx', exportRows()); close(); }}>Excel</MenuItem>
              </div>
            )}
          </div>
          <MenuItem onSelect={() => { close(); onColumns(); }}>Columns Customization</MenuItem>
        </>
      )}
    </MenuPopover>
  );
}

export default function TrafficSourcesManage() {
  const { data, loading, error, refetch } = useQuery<TrafficSource[]>('/api/traffic-sources');
  const [q, setQ] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>([...ALL_COLUMNS]);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (!q.trim()) return rows;
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(qq));
  }, [data, q]);

  const columnsByHeader: Record<string, Column<TrafficSource>> = {
    ID: { header: 'ID', cell: (r) => <span className="text-fg-secondary">{r.id.slice(0, 8)}</span> },
    Name: { header: 'Name', cell: (r) => <Link to={`/app/aff-traffic-sources/${r.id}/edit`} className="text-accent-text hover:underline">{r.name}</Link> },
    URL: { header: 'URL', cell: (r) => (r.enablePostback && r.postbackUrl ? <span className="block max-w-[280px] truncate font-mono text-tiny">{r.postbackUrl}</span> : <span className="text-fg-muted">-</span>) },
    'Tracking Link Parameters': { header: 'Tracking Link Parameters', cell: (r) => <span className="font-mono text-tiny">{r.trackingLinkParameters}</span> },
    Created: { header: 'Created', cell: (r) => new Date(r.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (r) => new Date(r.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<TrafficSource> = { header: '', className: 'text-right', cell: (r) => <RowMenu source={r} onDeleted={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<TrafficSource> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns]);

  return (
    <>
      <PageHeader title="Manage Traffic Sources" subtitle="Partners › Traffic Sources › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/aff-traffic-sources/new" className="btn-primary">+ Traffic Source</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <SourcesTableActions rows={filtered} onColumns={() => setShowColumns(true)} />
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No traffic sources match these filters.</StateBlock>
        : (
          <>
            <Table columns={displayedColumns} rows={filtered} rowKey={(r) => r.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
          </>
        )}

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}

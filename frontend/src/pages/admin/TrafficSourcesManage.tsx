/**
 * Partners › Traffic Sources › Manage — verified item-by-item against the live reference. Each
 * traffic source is a reusable preset of tracking-link query Parameter/Value pairs (values often
 * containing macros like {sub1}) a Partner picks when generating a link, plus an optional
 * postback URL. No status/Active filter here — the reference doesn't have one for this page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MoreVertical } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import { ColumnsModal } from '../../components/TableActionsKit';
import type { TrafficSource } from '../../types';

const ALL_COLUMNS = ['ID', 'Name', 'URL', 'Tracking Link Parameters', 'Created', 'Modified'] as const;

function RowMenu({ source, onDeleted }: { source: TrafficSource; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/traffic-sources/${source.id}`));

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const doDelete = async () => {
    setOpen(false);
    if (!confirm(`Delete traffic source "${source.name}"?`)) return;
    if (await del.run(undefined)) onDeleted();
  };

  const item = (label: string, onClick: () => void) => (
    <button role="menuitem" onClick={onClick} className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
      {label}
    </button>
  );

  return (
    <>
      <button ref={btnRef} title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-36 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item('Edit', () => { setOpen(false); nav(`/app/aff-traffic-sources/${source.id}/edit`); })}
          {item('Delete', doDelete)}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function TrafficSourcesManage() {
  const { data, loading, error, refetch } = useQuery<TrafficSource[]>('/api/traffic-sources');
  const [q, setQ] = useState('');
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
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
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

/**
 * Advertisers › Link Templates › Manage — verified item-by-item against the live reference: simple
 * list (ID/Name/Advertiser/Destination URL/Created/Modified), search, an Advertiser-only Filters
 * flyout, a Table Actions kebab with just Columns Customization (no Export/API Request on this
 * page in the reference), and a row kebab (Edit/Delete/History).
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { Link, useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, Pencil, Trash2, Clock } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Modal, Spinner, StateBlock, MenuItem, type Column } from '../../shared-components/primitives/ui';
import { CategoryFilterDrawer, type FilterCategory } from '../../shared-components/primitives/CategoryFilterDrawer';
import { ColumnsModal, TableRowMenu } from '../../shared-components/primitives/TableActionsKit';
import type { LinkTemplate, Advertiser } from '../../types';

const ALL_COLUMNS = ['ID', 'Name', 'Advertiser', 'Destination URL', 'Created', 'Modified'] as const;

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }
function HistoryModal({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/link-templates/${templateId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return (
    <Modal open onClose={onClose} title="Link Template History" size="xl">
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </Modal>
  );
}

function RowMenu({ template, onChanged }: { template: LinkTemplate; onChanged: () => void }) {
  const nav = useNavigate();
  const del = useMutation(() => api.del(`/api/link-templates/${template.id}`));
  const [historyOpen, setHistoryOpen] = useState(false);

  const doDelete = async (api: { close: () => void }) => {
    api.close();
    if (!confirm(`Delete link template "${template.name}"?`)) return;
    if (await del.run(undefined)) onChanged();
  };

  return (
    <>
      <TableRowMenu>
        {(api) => (
          <>
            <MenuItem icon={Pencil} onSelect={() => { api.close(); nav(`/app/adv-link-templates/${template.id}/edit`); }}>Edit</MenuItem>
            <MenuItem icon={Trash2} tone="danger" onSelect={() => doDelete(api)}>Delete</MenuItem>
            <MenuItem icon={Clock} onSelect={() => { api.close(); setHistoryOpen(true); }}>History</MenuItem>
          </>
        )}
      </TableRowMenu>
      {historyOpen && <HistoryModal templateId={template.id} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

export default function LinkTemplatesManage() {
  const { data, loading, error, refetch } = useQuery<LinkTemplate[]>('/api/link-templates');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');

  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = Object.values(filters).reduce((n, arr) => n + (arr?.length ?? 0), 0);
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

  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'advertiser', label: 'Advertiser', options: (advertisers ?? []).map((a) => ({ value: a.id, label: a.name })) },
  ], [advertisers]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      rows = rows.filter((t) => t.name.toLowerCase().includes(qq) || t.advertiserName.toLowerCase().includes(qq) || t.destinationUrl.toLowerCase().includes(qq));
    }
    const has = (key: string) => (filters[key]?.length ?? 0) > 0;
    if (has('advertiser')) rows = rows.filter((t) => filters['advertiser']!.includes(t.advertiserId));
    return rows;
  }, [data, q, filters]);

  const columnsByHeader: Record<string, Column<LinkTemplate>> = {
    ID: { header: 'ID', cell: (t) => <span className="tabular-nums text-fg-secondary">{t.ref}</span> },
    Name: { header: 'Name', cell: (t) => <Link to={`/app/adv-link-templates/${t.id}/edit`} className="font-medium text-accent-text hover:underline">{t.name}</Link> },
    Advertiser: { header: 'Advertiser', cell: (t) => <Link to={`/app/advertisers/${t.advertiserId}`} className="text-accent-text hover:underline">{t.advertiserName}{t.advertiserRef ? ` (${t.advertiserRef})` : ''}</Link> },
    'Destination URL': { header: 'Destination URL', cell: (t) => <span className="break-all font-mono text-tiny text-fg-secondary">{t.destinationUrl}</span> },
    Created: { header: 'Created', cell: (t) => new Date(t.createdAt).toLocaleString() },
    Modified: { header: 'Modified', cell: (t) => new Date(t.updatedAt).toLocaleString() },
  };
  const actionsCol: Column<LinkTemplate> = { header: '', className: 'text-right', cell: (t) => <RowMenu template={t} onChanged={refetch} /> };
  const shownColumns = useMemo<Set<string>>(() => new Set(ALL_COLUMNS.filter((c) => !hiddenColumns.has(c))), [hiddenColumns]);
  const displayedColumns = useMemo(() => {
    const ordered = columnOrder.map((h) => columnsByHeader[h]).filter((c): c is Column<LinkTemplate> => Boolean(c && shownColumns.has(c.header)));
    return [...ordered, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, shownColumns, filtered]);

  return (
    <>
      <PageHeader title="Manage Link Templates" subtitle="Advertisers › Link Templates › Manage" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/adv-link-templates/new" className="btn-primary">+ Link Template</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setFilterOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg relative">
              <SlidersHorizontal size={15} />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filterOpen && (
              <CategoryFilterDrawer categories={FILTER_CATEGORIES} values={filters}
                onApply={setFilters} onClose={() => setFilterOpen(false)} />
            )}
          </div>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No Record Found</StateBlock>
        : (
          <>
            <Table columns={displayedColumns} rows={filtered} rowKey={(t) => t.id} />
            <div className="mt-3 flex items-center justify-end text-tiny text-fg-secondary"><span>{filtered.length} Total</span></div>
          </>
        )}

      {showColumns && <ColumnsModal allColumns={ALL_COLUMNS} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(o, h) => { setColumnOrder(o); setHiddenColumns(h); }} />}
    </>
  );
}

/**
 * Control Center › Segmentations — categories, channels, business units, and labels wired to
 * /api/control-center/* CRUD and /api/tags.
 */
import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../../lib/api';
import { cc } from '../../../lib/controlCenter';
import { useQuery } from '../../../lib/useApi';
import { StateBlock, Spinner, Tabs } from '../../../shared-components/primitives/ui';

const SUB_TABS = ['Categories', 'Channels', 'Labels', 'Business Unit'] as const;

interface SegRow {
  id: string; ref?: number | null; name: string; status: string;
  createdAt: string; updatedAt: string;
}

function statusParam(s: string) {
  return s === 'All' ? 'all' : s.toLowerCase();
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

const STATUS_OPTIONS = ['All', 'Active', 'Inactive', 'Deleted'] as const;
const STATUS_DOT: Record<string, string> = { All: 'bg-fg-muted', Active: 'bg-success', Inactive: 'bg-warning', Deleted: 'bg-danger' };

/** Search is controlled by the parent, so the visible box and the applied filter can never diverge
 *  (the sub-tab shows a spinner while refetching, which remounts this toolbar). */
function Toolbar({ addLabel, status, onAdd, onStatusChange, search, onSearch }: {
  addLabel: string; status?: string; onAdd?: () => void; onStatusChange?: (s: string) => void; search: string; onSearch: (q: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <button className="btn-primary" onClick={onAdd}>+ {addLabel}</button>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input placeholder="Search…" aria-label="Search" className="input !pl-8 !w-56" value={search} onChange={(e) => onSearch(e.target.value)} />
        </div>
        {status && onStatusChange && (
          <div className="relative">
            <span className={`pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${STATUS_DOT[status] ?? 'bg-fg-muted'}`} />
            <select aria-label="Status" className="input !w-auto !pl-7" value={status} onChange={(e) => onStatusChange(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function SegTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="premium-table">
        <thead className="bg-page text-tiny uppercase tracking-wide text-fg-secondary">
          <tr>{columns.map((c) => <th key={c} >{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CrudSub({ resource, addLabel, columns, desc }: {
  resource: string; addLabel: string; columns: string[]; desc: string;
}) {
  const [status, setStatus] = useState('Active');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const path = `/api/control-center/${resource}?status=${statusParam(status)}`;
  const { data, loading, refetch } = useQuery<SegRow[]>(path);
  const rows = (data ?? []).filter((r) => !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()));
  const filtered = rows;

  const submit = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      if (!name.trim()) throw new Error('Name is required.');
      await cc.create(resource, { name: name.trim() });
      setName('');
      setAdding(false);
      refetch();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;

  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">{desc}</p>
      {adding && (
        <div className="card mb-3 flex flex-wrap items-end gap-2">
          {saveError && <p className="text-small text-danger-text">{saveError}</p>}
          <div className="flex-1">
            <label className="label">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      <Toolbar addLabel={addLabel} status={status} onAdd={() => setAdding(true)} onStatusChange={(next) => setStatus(next)} search={search} onSearch={setSearch} />
      {filtered.length === 0 ? (
        <p className="rounded-card border border-dashed border-border py-10 text-center text-small italic text-fg-muted">No Record Found</p>
      ) : (
        <SegTable columns={[...columns, '']}>
          {rows.map((r) => (
            <tr key={r.id} className="bg-surface text-fg">
              {columns.map((col) => {
                if (col === 'ID') return <td key={col} className="px-4 py-3 text-fg-secondary">{r.ref ?? '—'}</td>;
                if (col === 'Name') return <td key={col} className="px-4 py-3 font-medium">{resource === 'channels' && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-success" />}{r.name}</td>;
                if (col === 'Status') return <td key={col} className="px-4 py-3 capitalize">{r.status}</td>;
                if (col === 'Created') return <td key={col} className="px-4 py-3">{fmtDate(r.createdAt)}</td>;
                if (col === 'Modified') return <td key={col} className="px-4 py-3">{fmtDate(r.updatedAt)}</td>;
                if (col === 'Offers') return <td key={col} className="px-4 py-3 text-fg-muted">—</td>;
                return <td key={col} className="px-4 py-3">—</td>;
              })}
              <td className="px-4 py-3 text-right">
                <button className="text-tiny text-danger-text hover:underline" onClick={async () => { await cc.del(resource, r.id); refetch(); }}>Delete</button>
              </td>
            </tr>
          ))}
        </SegTable>
      )}
    </div>
  );
}

function LabelsSub() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data, loading, refetch } = useQuery<Array<{
    id: string; name: string; color: string | null;
    advertisers: number; partners: number; offers: number; partnerTiers: number;
  }>>('/api/control-center/tags-with-usage');
  const [search, setSearch] = useState('');
  const allTags = data ?? [];
  const needle = search.trim().toLowerCase();
  const tags = needle ? allTags.filter((t) => t.name.toLowerCase().includes(needle)) : allTags;

  const submit = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      if (!name.trim()) throw new Error('Label name is required.');
      await api.post('/api/tags', { name: name.trim() });
      setName('');
      setAdding(false);
      refetch();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;

  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">Set custom tags to link with a Partner, Advertiser, or Offer for internal reporting, searching, or filtering.</p>
      {adding && (
        <div className="card mb-3 flex flex-wrap items-end gap-2">
          {saveError && <p className="text-small text-danger-text">{saveError}</p>}
          <div className="flex-1">
            <label className="label">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      <Toolbar addLabel="Label" onAdd={() => setAdding(true)} search={search} onSearch={setSearch} />
      {tags.length === 0 ? (
        <p className="rounded-card border border-dashed border-border py-10 text-center text-small italic text-fg-muted">{allTags.length > 0 ? 'No Record Found' : 'No labels yet.'}</p>
      ) : (
        <SegTable columns={['Name', 'Advertisers', 'Partners', 'Smart Links', 'Offers', 'Offer Groups', 'Partner Tiers', '']}>
          {tags.map((t) => (
            <tr key={t.id} className="bg-surface text-fg">
              <td className="px-4 py-3 font-medium text-accent-text"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color ?? '#94a3b8' }} />{t.name}</td>
              <td className="px-4 py-3">{t.advertisers}</td>
              <td className="px-4 py-3">{t.partners}</td>
              <td className="px-4 py-3">0</td>
              <td className="px-4 py-3">{t.offers}</td>
              <td className="px-4 py-3">0</td>
              <td className="px-4 py-3">{t.partnerTiers}</td>
              <td className="px-4 py-3 text-right">
                <button className="text-tiny text-danger-text hover:underline" onClick={async () => { await api.del(`/api/tags/${t.id}`); refetch(); }}>Delete</button>
              </td>
            </tr>
          ))}
        </SegTable>
      )}
    </div>
  );
}

export default function SegmentationsTab() {
  const [sub, setSub] = useState<string>('Categories');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'Categories' && (
        <CrudSub resource="categories" addLabel="Category" columns={['ID', 'Name', 'Status', 'Created', 'Modified']}
          desc="Facilitate search and reporting of grouped Offers by assigning categories. This will be visible internally and externally by Partners." />
      )}
      {sub === 'Channels' && (
        <CrudSub resource="channels" addLabel="Channel" columns={['Name', 'Offers', 'Created', 'Modified']}
          desc="Assign tags to identify types of traffic sources at the Partner Level." />
      )}
      {sub === 'Labels' && <LabelsSub />}
      {sub === 'Business Unit' && (
        <CrudSub resource="business-units" addLabel="Business Unit" columns={['Name']}
          desc="Categorize the internal structure of your Networks. For example, Finance, Sales, European Department, etc." />
      )}
    </>
  );
}

/**
 * Control Center › Segmentations — categories, channels, business units, and labels wired to
 * /api/control-center/* CRUD and /api/tags.
 */
import { useState, type ReactNode } from 'react';
import { Search, MoreVertical, ChevronDown } from 'lucide-react';
import { api } from '../../../lib/api';
import { cc } from '../../../lib/controlCenter';
import { useQuery, useMutation } from '../../../lib/useApi';
import { StateBlock, Spinner, Tabs } from '../../../components/ui';

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

function Toolbar({ addLabel, status, onAdd, onStatusChange, moreVertical }: {
  addLabel: string; status?: string; onAdd?: () => void; onStatusChange?: (s: string) => void; moreVertical?: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <button className="btn-primary" onClick={onAdd}>+ {addLabel}</button>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input placeholder="Search…" className="input !w-56 !pl-8" />
        </div>
        {status && onStatusChange && (
          <button className="input flex !w-auto items-center gap-2 !py-1.5" onClick={() => onStatusChange(status === 'Active' ? 'Inactive' : 'Active')}>
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" />{status}<ChevronDown size={14} className="text-fg-muted" />
          </button>
        )}
        {moreVertical && <button className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>}
      </div>
    </div>
  );
}

function SegTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[640px] text-left text-body">
        <thead className="bg-page text-tiny uppercase tracking-wide text-fg-secondary">
          <tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
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
  const path = `/api/control-center/${resource}?status=${statusParam(status)}`;
  const { data, loading, refetch } = useQuery<SegRow[]>(path);
  const createMut = useMutation((body: Record<string, unknown>) => cc.create(resource, body));
  const rows = data ?? [];

  const submit = async () => {
    if (!name.trim()) return;
    if (await createMut.run({ name: name.trim() })) {
      setName('');
      setAdding(false);
      refetch();
    }
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;

  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">{desc}</p>
      {adding && (
        <div className="card mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="label mb-1 block">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={createMut.busy}>{createMut.busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      <Toolbar addLabel={addLabel} status={status} onAdd={() => setAdding(true)} onStatusChange={setStatus} moreVertical={resource === 'channels'} />
      {rows.length === 0 ? (
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
  const { data, loading, refetch } = useQuery<Array<{
    id: string; name: string; color: string | null;
    advertisers: number; partners: number; offers: number; partnerTiers: number;
  }>>('/api/control-center/tags-with-usage');
  const createMut = useMutation((body: { name: string }) => api.post('/api/tags', body));
  const tags = data ?? [];

  const submit = async () => {
    if (!name.trim()) return;
    if (await createMut.run({ name: name.trim() })) {
      setName('');
      setAdding(false);
      refetch();
    }
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;

  return (
    <div>
      <p className="mb-3 text-small text-fg-secondary">Set custom tags to link with a Partner, Advertiser, or Offer for internal reporting, searching, or filtering.</p>
      {adding && (
        <div className="card mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="label mb-1 block">Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={createMut.busy}>{createMut.busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
      <Toolbar addLabel="Label" onAdd={() => setAdding(true)} moreVertical />
      {tags.length === 0 ? (
        <p className="rounded-card border border-dashed border-border py-10 text-center text-small italic text-fg-muted">No labels yet.</p>
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

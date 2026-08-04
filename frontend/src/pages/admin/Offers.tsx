import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Spinner, StateBlock, type Column } from '../../components/ui';
import { StatCards } from '../../components/StatCards';
import { SearchFilterDrawer, FieldBlock } from '../../components/SearchFilterDrawer';
import type { Offer, Advertiser } from '../../types';

const STATUS_OPTS = ['active', 'paused', 'pending', 'expired', 'disabled'] as const;

export default function Offers() {
  const { data, loading, error } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const advName = (id: string) => {
    const a = advertisers?.find((x) => x.id === id);
    return a ? (a.ref != null ? `(${a.ref}) ${a.name}` : a.name) : id.slice(0, 8) + '…';
  };

  // Applied filters (Trackog Manage Offer defaults: Active checked)
  const [statuses, setStatuses] = useState<string[]>(['active']);
  const [offerIdsText, setOfferIdsText] = useState('');
  const [nameQ, setNameQ] = useState('');
  const [advertiserId, setAdvertiserId] = useState('');
  const [objective, setObjective] = useState('');
  const [visibility, setVisibility] = useState('');
  const [open, setOpen] = useState(false);

  // Draft while drawer open
  const [dStatuses, setDStatuses] = useState(statuses);
  const [dIds, setDIds] = useState(offerIdsText);
  const [dName, setDName] = useState(nameQ);
  const [dAdv, setDAdv] = useState(advertiserId);
  const [dObj, setDObj] = useState(objective);
  const [dVis, setDVis] = useState(visibility);

  const openDrawer = () => {
    setDStatuses(statuses); setDIds(offerIdsText); setDName(nameQ);
    setDAdv(advertiserId); setDObj(objective); setDVis(visibility); setOpen(true);
  };
  const applyDrawer = () => {
    setStatuses(dStatuses); setOfferIdsText(dIds); setNameQ(dName);
    setAdvertiserId(dAdv); setObjective(dObj); setVisibility(dVis); setOpen(false);
  };
  const clearDraft = () => {
    setDStatuses([]); setDIds(''); setDName(''); setDAdv(''); setDObj(''); setDVis('');
  };

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (statuses.length) rows = rows.filter((o) => statuses.includes(o.status));
    if (nameQ.trim()) {
      const q = nameQ.trim().toLowerCase();
      rows = rows.filter((o) => o.name.toLowerCase().includes(q));
    }
    if (offerIdsText.trim()) {
      const ids = offerIdsText.split(',').map((s) => s.trim()).filter(Boolean);
      rows = rows.filter((o) => ids.includes(String(o.ref)) || ids.includes(o.id));
    }
    if (advertiserId) rows = rows.filter((o) => o.advertiserId === advertiserId);
    if (objective) rows = rows.filter((o) => (o.objective ?? o.payoutModel) === objective);
    if (visibility) rows = rows.filter((o) => (o.visibility ?? 'public') === visibility);
    return rows;
  }, [data, statuses, nameQ, offerIdsText, advertiserId, objective, visibility]);

  const appliedCount = statuses.length + (offerIdsText ? 1 : 0) + (nameQ ? 1 : 0)
    + (advertiserId ? 1 : 0) + (objective ? 1 : 0) + (visibility ? 1 : 0);
  const draftCount = dStatuses.length + (dIds ? 1 : 0) + (dName ? 1 : 0)
    + (dAdv ? 1 : 0) + (dObj ? 1 : 0) + (dVis ? 1 : 0);

  const columns: Column<Offer>[] = [
    { header: 'ID', cell: (o) => <span className="font-mono tabular-nums text-fg-muted">{o.ref ?? '—'}</span> },
    { header: 'Title', cell: (o) => <Link to={`/app/offers/${o.id}`} className="font-medium text-accent hover:underline">{o.name}</Link> },
    { header: 'Status', cell: (o) => <StatusDot value={o.status} /> },
    { header: 'Advertiser', cell: (o) => <span className="text-small text-fg-secondary">{advName(o.advertiserId)}</span> },
    { header: 'Visibility', cell: (o) => <span className="capitalize text-fg-secondary">{o.visibility ?? 'public'}</span> },
    { header: 'Objective', cell: (o) => <span className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">{o.objective ?? o.payoutModel}</span> },
    { header: 'Payout', className: 'text-right', cell: (o) => <span className="tabular-nums">{o.currency} {o.defaultPayout}</span> },
    { header: 'Revenue', className: 'text-right', cell: (o) => <span className="tabular-nums">{o.currency} {o.defaultRevenue}</span> },
    { header: '', className: 'text-right', cell: (o) => <Link to={`/app/offers/${o.id}`} className="text-tiny font-medium text-fg-secondary hover:text-accent hover:underline">Manage →</Link> },
  ];

  const toggleStatus = (s: string) =>
    setDStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <>
      <PageHeader
        title="Manage Offer"
        subtitle="Create, manage and optimize your affiliate Offer."
        action={
          <div className="flex gap-2">
            <button type="button" className="btn-ghost relative" onClick={openDrawer}>
              Filters
              {appliedCount > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
                  {appliedCount}
                </span>
              )}
            </button>
            <Link to="/app/offers/new" className="btn-primary">+ Create Offer</Link>
          </div>
        }
      />
      <StatCards endpoint="/api/offers/stats" cards={[
        { key: 'total', label: 'Total Offers', tone: 'blue', icon: 'offers' },
        { key: 'active', label: 'Active', tone: 'teal', icon: 'chart' },
        { key: 'pending', label: 'Pending', tone: 'violet', icon: 'wallet' },
        { key: 'paused', label: 'Paused/Disabled', tone: 'rose', icon: 'alert' },
      ]} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !filtered.length ? <StateBlock>No offers match these filters.</StateBlock>
        : <Table columns={columns} rows={filtered} rowKey={(o) => o.id} />}

      {open && (
        <SearchFilterDrawer appliedCount={draftCount} onClose={() => setOpen(false)} onApply={applyDrawer}>
          <div className="mb-3 flex justify-end">
            <button type="button" className="text-tiny font-medium text-accent hover:underline" onClick={clearDraft}>Clear</button>
          </div>
          <FieldBlock label="Offer IDs">
            <input className="input" placeholder="e.g. 101, 205, 310" value={dIds} onChange={(e) => setDIds(e.target.value)} />
            <p className="mt-1 text-[11px] text-fg-muted">Comma separated IDs</p>
          </FieldBlock>
          <FieldBlock label="Offer Name">
            <input className="input" placeholder="Search by offer name..." value={dName} onChange={(e) => setDName(e.target.value)} />
          </FieldBlock>
          <div className="mb-4">
            <p className="label">Status</p>
            <div className="space-y-1.5">
              {STATUS_OPTS.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-small capitalize text-fg hover:bg-subtle">
                  <input type="checkbox" className="chk" checked={dStatuses.includes(s)} onChange={() => toggleStatus(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <FieldBlock label="Advertisers">
            <select className="input" value={dAdv} onChange={(e) => setDAdv(e.target.value)}>
              <option value="">Select Advertisers</option>
              {(advertisers ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.ref != null ? `(${a.ref}) ${a.name}` : a.name}</option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label="Tags">
            <select className="input" disabled>
              <option>Select Tags</option>
            </select>
          </FieldBlock>
          <FieldBlock label="Categories">
            <select className="input" disabled>
              <option>Select Categories</option>
            </select>
          </FieldBlock>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <FieldBlock label="Objective">
              <select className="input" value={dObj} onChange={(e) => setDObj(e.target.value)}>
                <option value="">All Objectives</option>
                <option value="conversions">Conversions</option>
                <option value="sale">Sale</option>
                <option value="app_installs">App Installs</option>
                <option value="leads">Leads</option>
                <option value="impressions">Impressions</option>
                <option value="clicks">Clicks</option>
              </select>
            </FieldBlock>
            <FieldBlock label="Visibility">
              <select className="input" value={dVis} onChange={(e) => setDVis(e.target.value)}>
                <option value="">All Visibility</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="ask">Ask</option>
              </select>
            </FieldBlock>
          </div>
        </SearchFilterDrawer>
      )}
    </>
  );
}

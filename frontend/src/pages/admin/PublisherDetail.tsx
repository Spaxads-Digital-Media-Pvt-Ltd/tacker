import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, StatusDot, Spinner, StateBlock, StatCard, type Column } from '../../components/ui';
import { CollectionTab } from '../../components/CollectionTab';
import { PostbackTester } from '../../components/PostbackTester';
import { CustomFieldsPanel } from '../../components/CustomFieldsPanel';
import type { Publisher, Offer } from '../../types';

type Row = { id: string; [k: string]: unknown };
const TABS = ['Overview', 'Postbacks', 'Postback Test', 'Custom Fields', 'Tags'] as const;

export default function PublisherDetail() {
  const { id = '' } = useParams();
  const base = `/api/publishers/${id}`;
  const { data: pub, loading, error } = useQuery<Publisher>(base);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [tab, setTab] = useState<string>('Overview');

  const offerOptions = [{ value: '', label: 'All offers' }, ...(offers ?? []).map((o) => ({ value: o.id, label: o.name }))];

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !pub) return <StateBlock>{error ?? 'Publisher not found'}</StateBlock>;

  return (
    <>
      <PageHeader
        title={pub.name}
        subtitle={`Publisher · ${pub.status}`}
        action={<Link to="/app/publishers" className="btn-ghost">← All publishers</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
        <span>ID <b className="font-mono tabular-nums">{pub.ref ?? '—'}</b></span>
        <span className="text-fg-muted">·</span>
        <span className="text-fg-secondary">Unique ID <span className="select-all font-mono text-tiny">{pub.id}</span></span>
      </div>
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />

      {tab === 'Overview' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Status" value={pub.status} />
          <StatCard label="Traffic source" value={pub.trafficSource ?? '—'} />
          <StatCard label="Contact" value={pub.contactEmail ?? '—'} />
          <StatCard label="Payout terms" value={pub.payoutTerms ?? '—'} />
        </div>
      )}

      {tab === 'Postbacks' && (
        <CollectionTab
          basePath={`${base}/postbacks`}
          addLabel="Add postback"
          emptyText="No postbacks. Add an outbound postback URL fired to this publisher on conversion."
          fields={[
            { key: 'url', label: 'Postback URL (with macros)', type: 'url', required: true, placeholder: 'https://pub.com/pb?cid={click_id}&payout={payout}' },
            { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'], default: 'GET' },
            { key: 'event', label: 'Event (blank = any)', placeholder: 'purchase' },
            { key: 'offerId', label: 'Offer (blank = all)', type: 'select', options: offerOptions },
          ]}
          columns={[
            { header: 'URL', cell: (r) => <span className="block max-w-[320px] truncate font-mono text-tiny text-fg-secondary">{String(r.url)}</span> },
            { header: 'Method', cell: (r) => String(r.method) },
            { header: 'Event', cell: (r) => String(r.event ?? 'any') },
            { header: 'Status', cell: (r) => <StatusDot value={String(r.status)} /> },
          ] as Column<Row>[]}
        />
      )}

      {tab === 'Postback Test' && <PostbackTester testPath={`${base}/postbacks/test`} />}

      {tab === 'Custom Fields' && (
        <CustomFieldsPanel
          entityType="publisher"
          entityPath={base}
          values={pub.customFields ?? {}}
          key={JSON.stringify(pub.customFields)}
        />
      )}

      {tab === 'Tags' && (
        <CollectionTab
          basePath={`${base}/tags`}
          addLabel="Add tag"
          emptyText="No tags. Label this publisher for filtering and grouping."
          fields={[
            { key: 'name', label: 'Tag name', required: true, placeholder: 'Tier 1' },
            { key: 'color', label: 'Color (optional)', placeholder: '#7c3aed' },
          ]}
          columns={[
            { header: 'Tag', cell: (r) => <span className="font-medium">{String(r.name)}</span> },
            { header: 'Color', cell: (r) => String(r.color ?? '—') },
          ] as Column<Row>[]}
        />
      )}
    </>
  );
}

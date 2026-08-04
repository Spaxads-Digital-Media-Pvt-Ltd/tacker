import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Spinner, StateBlock, StatCard, type Column } from '../../components/ui';
import { CollectionTab } from '../../components/CollectionTab';
import { PostbackTester } from '../../components/PostbackTester';
import { CustomFieldsPanel } from '../../components/CustomFieldsPanel';
import type { Advertiser } from '../../types';

type Row = { id: string; [k: string]: unknown };
const TABS = ['Overview', 'Custom Fields', 'Debug Postback', 'Tags'] as const;

export default function AdvertiserDetail() {
  const { id = '' } = useParams();
  const base = `/api/advertisers/${id}`;
  const { data: adv, loading, error } = useQuery<Advertiser>(base);
  const [tab, setTab] = useState<string>('Overview');

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !adv) return <StateBlock>{error ?? 'Advertiser not found'}</StateBlock>;

  return (
    <>
      <PageHeader
        title={adv.name}
        subtitle={`Advertiser · ${adv.status} · ${adv.defaultCurrency}`}
        action={<Link to="/app/advertisers" className="btn-ghost">← All advertisers</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
        <span>ID <b className="font-mono tabular-nums">{adv.ref ?? '—'}</b></span>
        <span className="text-fg-muted">·</span>
        <span className="text-fg-secondary">Unique ID <span className="select-all font-mono text-tiny">{adv.id}</span></span>
      </div>
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />

      {tab === 'Overview' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Status" value={adv.status} />
          <StatCard label="Currency" value={adv.defaultCurrency} />
          <StatCard label="Contact" value={adv.contactEmail ?? '—'} />
          <StatCard label="Billing terms" value={adv.billingTerms ?? '—'} />
        </div>
      )}

      {tab === 'Custom Fields' && (
        <CustomFieldsPanel
          entityType="advertiser"
          entityPath={base}
          values={adv.customFields ?? {}}
          key={JSON.stringify(adv.customFields)}
        />
      )}

      {tab === 'Debug Postback' && (
        <PostbackTester
          testPath={`${base}/debug-postback`}
          hint="Fire the advertiser's conversion postback URL with sample macros to verify it responds. No conversion is recorded."
        />
      )}

      {tab === 'Tags' && (
        <CollectionTab
          basePath={`${base}/tags`}
          addLabel="Add tag"
          emptyText="No tags. Label this advertiser for filtering and grouping."
          fields={[
            { key: 'name', label: 'Tag name', required: true, placeholder: 'Direct' },
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

import { useState, type ReactNode } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Badge, Spinner, StateBlock, type Column } from '../../components/ui';
import { CollectionTab, type FieldDef } from '../../components/CollectionTab';
import type { Offer } from '../../types';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

const TABS = ['Revenue & Payout', 'Caps', 'Throttle Rates', 'Landing Pages', 'Creatives'] as const;
type Tab = (typeof TABS)[number];

const CATEGORY: Record<Tab, string> = {
  'Revenue & Payout': 'revenue_payout',
  Caps: 'caps',
  'Throttle Rates': 'throttle_rates',
  'Landing Pages': 'landing_pages',
  Creatives: 'creatives',
};
const ADD_LABEL: Record<Tab, string> = {
  'Revenue & Payout': 'Custom Revenue & Payout', Caps: 'Custom Cap', 'Throttle Rates': 'Throttle Rate',
  'Landing Pages': 'Landing Page', Creatives: 'Creative',
};

/** Offers › Custom Settings — network-wide counterpart to each Offer's own per-country geo-rules.
 * Groups by Partner/Event instead of country. `value`/`event` are the schema's shared generic
 * columns, re-labeled per category below (cap amount, throttle %, landing-page URL, creative name). */
export default function OfferCustomSettingsGlobal() {
  const [tab, setTab] = useState<Tab>('Revenue & Payout');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const offerName = (id: unknown) => (offers ?? []).find((o) => o.id === id)?.name ?? '—';

  const offerOptions = (offers ?? []).map((o) => ({ value: o.id, label: o.name }));
  const baseFields: FieldDef[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'offerId', label: 'Offer', type: 'select', options: offerOptions },
    { key: 'partnerIds', label: 'Partner IDs (comma separated)', type: 'tags' },
  ];

  const columnsByTab: Record<Tab, Column<Row>[]> = {
    'Revenue & Payout': [
      col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
      col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
      col('Offer', (r) => offerName(r.offerId)),
      col('Partners', (r) => count(r.partnerIds)),
      col('Description', (r) => (r.description ? String(r.description) : '—')),
      col('Public Description', (r) => (r.publicDescription ? String(r.publicDescription) : '—')),
      col('Event', (r) => (r.event ? String(r.event) : '—')),
    ],
    Caps: [
      col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
      col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
      col('Offer', (r) => offerName(r.offerId)),
      col('Partners', (r) => count(r.partnerIds)),
      col('Cap Type', (r) => (r.event ? String(r.event) : '—')),
      col('Cap Value', (r) => (r.value ? String(r.value) : '—')),
    ],
    'Throttle Rates': [
      col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
      col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
      col('Offer', (r) => offerName(r.offerId)),
      col('Partners', (r) => count(r.partnerIds)),
      col('Throttle Rate', (r) => (r.value ? `${r.value}%` : '—')),
      col('Redirect', (r) => (r.description ? String(r.description) : '—')),
    ],
    'Landing Pages': [
      col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
      col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
      col('Offer', (r) => offerName(r.offerId)),
      col('Partners', (r) => count(r.partnerIds)),
      col('URL', (r) => (r.value ? String(r.value) : '—')),
      col('Weight', (r) => (r.event ? String(r.event) : '—')),
    ],
    Creatives: [
      col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
      col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
      col('Offer', (r) => offerName(r.offerId)),
      col('Partners', (r) => count(r.partnerIds)),
      col('Creative', (r) => (r.value ? String(r.value) : '—')),
      col('Weight', (r) => (r.event ? String(r.event) : '—')),
    ],
  };

  const extraFieldsByTab: Record<Tab, FieldDef[]> = {
    'Revenue & Payout': [
      { key: 'description', label: 'Description' },
      { key: 'publicDescription', label: 'Public Description' },
      { key: 'event', label: 'Event' },
    ],
    Caps: [
      { key: 'event', label: 'Cap Type', type: 'select', options: ['Daily Click Cap', 'Daily Conversion Cap', 'Total Conversion Cap'] },
      { key: 'value', label: 'Cap Value', type: 'number' },
    ],
    'Throttle Rates': [
      { key: 'value', label: 'Throttle Rate (%)', type: 'number' },
      { key: 'description', label: 'Redirect URL', type: 'url' },
    ],
    'Landing Pages': [
      { key: 'value', label: 'URL', type: 'url' },
      { key: 'event', label: 'Weight', type: 'number' },
    ],
    Creatives: [
      { key: 'value', label: 'Creative' },
      { key: 'event', label: 'Weight', type: 'number' },
    ],
  };

  const columns = [...columnsByTab[tab], col('Status', (r) => <Badge value={String(r.status)} />), col('Created', (r) => fmt(r.createdAt))];
  const fields: FieldDef[] = [
    { key: 'category', label: 'Category', type: 'hidden', default: CATEGORY[tab] },
    ...baseFields,
    ...extraFieldsByTab[tab],
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
  ];

  return (
    <>
      <PageHeader title="Manage Custom Settings" subtitle="Offers › Custom Settings › Manage" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as Tab)} />
      {!offers ? (
        <StateBlock><Spinner /></StateBlock>
      ) : (
        <CollectionTab
          key={tab}
          basePath="/api/offer-custom-settings"
          listPath={`/api/offer-custom-settings?category=${CATEGORY[tab]}`}
          addLabel={ADD_LABEL[tab]}
          emptyText="No custom settings yet."
          editable
          fields={fields}
          columns={columns}
        />
      )}
    </>
  );
}

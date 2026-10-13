import { useState, type ReactNode } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Badge, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import { CollectionTab, type FieldDef } from '../../shared-components/panels/CollectionTab';
import type { Offer, Publisher } from '../../types';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');

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

/** These rows are applied per partner at runtime (F-12) — see api-backend
 * lib/offer-settings/custom-settings.ts. Each tab says what its rows do. */
const NOT_ENFORCED_NOTE: Record<Tab, string> = {
  'Revenue & Payout': 'Applied per partner: their conversions on the offer (or on the chosen goal) earn this payout / bill this revenue instead of the default, goal, partner or per-country rate. CPA = a fixed amount; CPS = a % of the reported sale amount.',
  Caps: 'Applied per partner, on top of each offer’s own caps: click caps at /click; conversion, payout and revenue caps as conversions come in.',
  'Throttle Rates': 'Applied per partner: this share of the partner’s conversions gets the chosen status (rejected unless set to pending).',
  'Landing Pages': 'Applied per partner at /click: their visitors land here instead of the offer’s Destination URL (or a per-country Destination override).',
  Creatives: 'Reference list. Partner-facing creative assets live in Offers → Creatives.',
};
const PAYOUT_MODELS = ['CPA', 'CPA_PPP', 'CPS', 'CPS_PPP', 'CPA_CPS', 'CPA_CPS_PPP', 'CPC', 'CPM', 'PRV', 'PRV_PPP'];
const CAP_TYPES = [{ value: 'clicks', label: 'Clicks' }, { value: 'conversions', label: 'Conversions' }, { value: 'payout', label: 'Payout' }, { value: 'revenue', label: 'Revenue' }];
const CAP_INTERVALS = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'global', label: 'Global (all time)' }];
const CREATIVE_TYPES = ['image', 'html', 'link', 'text', 'email', 'video', 'archive', 'thumbnail'];
/** Offers › Custom Settings — network-wide list of each offer's per-partner overrides (the v2
 * typed columns: payout/revenue, caps, throttle rate, landing page, creative). */
export default function OfferCustomSettingsGlobal() {
  const [tab, setTab] = useState<Tab>('Revenue & Payout');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const offerName = (id: unknown) => (offers ?? []).find((o) => o.id === id)?.name ?? '—';
  const offerOptions = (offers ?? []).map((o) => ({ value: o.id, label: o.name }));
  const partnerOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.name }));
  const partners = (r: Row) => (Array.isArray(r.partnerIds) && r.partnerIds.length ? r.partnerIds.length
    : r.partnerId ? 1 : 'All');
  const baseFields: FieldDef[] = [
    { key: 'name', label: 'Name' },
    { key: 'offerId', label: 'Offer', type: 'select', options: offerOptions, required: true },
    { key: 'partnerIds', label: 'Partners (empty = all)', type: 'multiselect', options: partnerOptions, placeholder: 'Type to search partners…' },
  ];
  const idCol = col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>);
  const nameCol = col('Name', (r) => <span className="font-medium text-fg">{r.name ? String(r.name) : '—'}</span>);
  const offerCol = col('Offer', (r) => offerName(r.offerId));
  const partnersCol = col('Partners', (r) => <span className="tabular-nums">{partners(r)}</span>);
  const columnsByTab: Record<Tab, Column<Row>[]> = {
    'Revenue & Payout': [
      idCol, nameCol, offerCol, partnersCol,
      col('Payout', (r) => (r.applyCustomPayout && r.payoutValue != null ? `${String(r.payoutValue)} (${String(r.payoutModel ?? 'CPA')})` : '—')),
      col('Revenue', (r) => (r.applyCustomRevenue && r.revenueValue != null ? `${String(r.revenueValue)} (${String(r.revenueModel ?? 'CPA')})` : '—')),
      col('Description', (r) => (r.description ? String(r.description) : '—')),
    ],
    Caps: [
      idCol, nameCol, offerCol, partnersCol,
      col('Cap Type', (r) => (r.capType ? `${String(r.capType)} / ${String(r.capInterval)}` : 'Multiple')),
      col('Cap Value', (r) => <span className="tabular-nums">{r.capValue != null ? Number(r.capValue).toLocaleString() : '—'}</span>),
    ],
    'Throttle Rates': [
      idCol, nameCol, offerCol, partnersCol,
      col('Throttle Rate', (r) => <span className="tabular-nums">{r.throttleRate != null ? `${String(r.throttleRate)}%` : '—'}</span>),
      col('Status Set', (r) => (r.conversionStatus ? String(r.conversionStatus) : 'rejected')),
    ],
    'Landing Pages': [
      idCol, nameCol, offerCol, partnersCol,
      col('URL', (r) => (r.landingPageUrl ? String(r.landingPageUrl) : '—')),
    ],
    Creatives: [
      idCol, nameCol, offerCol, partnersCol,
      col('Type', (r) => (r.creativeType ? String(r.creativeType) : '—')),
      col('Creative', (r) => (r.creativeUrl ? String(r.creativeUrl) : '—')),
    ],
  };
  const extraFieldsByTab: Record<Tab, FieldDef[]> = {
    'Revenue & Payout': [
      { key: 'payoutModel', label: 'Payout Model', type: 'select', options: PAYOUT_MODELS, default: 'CPA' },
      { key: 'payoutValue', label: 'Payout', type: 'money' },
      { key: 'revenueModel', label: 'Revenue Model', type: 'select', options: PAYOUT_MODELS, default: 'CPA' },
      { key: 'revenueValue', label: 'Revenue', type: 'money' },
      { key: 'description', label: 'Description' },
      { key: 'publicDescription', label: 'Public Description' },
    ],
    Caps: [
      { key: 'capType', label: 'Cap Type', type: 'select', options: CAP_TYPES, default: 'clicks' },
      { key: 'capInterval', label: 'Cap Window', type: 'select', options: CAP_INTERVALS, default: 'daily' },
      { key: 'capValue', label: 'Cap Value', type: 'number', required: true },
    ],
    'Throttle Rates': [
      { key: 'throttleRate', label: 'Throttle Rate (%)', type: 'number', required: true },
      { key: 'conversionStatus', label: 'Throttled Conversion Status', type: 'select', options: ['rejected', 'pending'], default: 'rejected' },
    ],
    'Landing Pages': [
      { key: 'landingPageUrl', label: 'URL', type: 'url', required: true },
    ],
    Creatives: [
      { key: 'creativeType', label: 'Type', type: 'select', options: CREATIVE_TYPES, default: 'image' },
      { key: 'creativeUrl', label: 'Creative URL', type: 'url' },
    ],
  };
  const columns = [...columnsByTab[tab], col('Status', (r) => <Badge value={String(r.status)} />), col('Created', (r) => fmt(r.createdAt))];
  const fields: FieldDef[] = [
    { key: 'category', label: 'Category', type: 'hidden', default: CATEGORY[tab] },
    ...baseFields,
    ...extraFieldsByTab[tab],
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' },
  ];

  return (
    <>
      <PageHeader title="Manage Custom Settings" subtitle="Offers › Custom Settings › Manage" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as Tab)} />
      <p className="mb-4 rounded-card border border-border bg-page px-3 py-2 text-[11px] text-fg-muted">{NOT_ENFORCED_NOTE[tab]}</p>
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
          searchKeys={['name', 'description', 'publicDescription', 'landingPageUrl', 'creativeUrl']}
          searchPlaceholder="Search by name…"
          fields={fields}
          columns={columns}
        />
      )}
    </>
  );
}

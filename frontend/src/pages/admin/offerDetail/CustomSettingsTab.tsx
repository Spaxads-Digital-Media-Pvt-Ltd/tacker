import type { ReactNode } from 'react';
import { useQuery } from '../../../lib/useApi';
import type { Publisher } from '../../../types';
import { CollectionTab, type FieldDef } from '../../../shared-components/panels/CollectionTab';
import { Accordion } from '../../../shared-components/panels/Accordion';
import type { Column } from '../../../shared-components/primitives/ui';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const num = (v: unknown, suffix = '') => (v == null || v === '' ? '—' : <span className="tabular-nums">{String(v)}{suffix}</span>);

/** Applied at the click path today (per-country, on offer_geo_rules). */
const LIVE_NOTE = 'These per-country overrides ARE applied at /click — the resolved payout/revenue/destination is frozen onto each click and flows to the ledger.';
/** offer_custom_settings rows — applied per partner at /click and to their conversions (F-12). */
const REF_NOTES: Record<string, string> = {
  caps: 'Applied per partner, on top of this offer’s own caps: click caps at /click; conversion, payout and revenue caps as conversions come in.',
  throttle_rates: 'Applied per partner: this share of the partner’s conversions gets the chosen status (rejected unless set to pending).',
  landing_pages: 'Applied per partner at /click: their visitors land here instead of the offer’s Destination URL (or a per-country Destination override above).',
  creatives: 'Stored for reference. Partner-facing creative assets live in the Creatives tab / Offers → Creatives.',
};

function Note({ children }: { children: ReactNode }) {
  return <p className="mb-3 rounded-card border border-border bg-page px-3 py-2 text-[11px] text-fg-muted">{children}</p>;
}

/** "Custom Payout Revenue Settings" is per-country (via the offer's geo-rules). The other four
 * reuse the network-wide offer_custom_settings table (same backend as Offers › Custom Settings),
 * scoped to this offer via a hidden offerId + category field on each row. */
function CategoryPanel({
  offerId, category, addLabel, emptyText, extraFields, columns,
}: {
  offerId: string; category: string; addLabel: string; emptyText: string;
  extraFields: FieldDef[]; columns: Column<Row>[];
}) {
  const fields: FieldDef[] = [
    { key: 'category', label: '', type: 'hidden', default: category },
    { key: 'offerId', label: '', type: 'hidden', default: offerId },
    { key: 'name', label: 'Name' },
    ...extraFields,
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' },
  ];
  return (
    <>
      {REF_NOTES[category] && <Note>{REF_NOTES[category]}</Note>}
      <CollectionTab
        basePath="/api/offer-custom-settings"
        listPath={`/api/offer-custom-settings?category=${category}&offerId=${offerId}`}
        addLabel={addLabel}
        emptyText={emptyText}
        editable
        searchKeys={['name', 'landingPageUrl', 'creativeUrl', 'description']}
        searchPlaceholder="Search by name…"
        fields={fields}
        columns={columns}
      />
    </>
  );
}

const CAP_TYPES = [{ value: 'clicks', label: 'Clicks' }, { value: 'conversions', label: 'Conversions' }, { value: 'payout', label: 'Payout' }, { value: 'revenue', label: 'Revenue' }];
const CAP_INTERVALS = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'global', label: 'Global (all time)' }];
const CREATIVE_TYPES = ['image', 'html', 'link', 'text', 'email', 'video', 'archive', 'thumbnail'];

export function CustomSettingsTab({ base, offerId }: { base: string; offerId: string }) {
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const partnerOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.name }));
  const partnerName = (id: unknown) => (id ? (publishers ?? []).find((p) => p.id === id)?.name ?? String(id).slice(0, 8) : 'All partners');
  const partnerCount = (r: Row) => (Array.isArray(r.partnerIds) && r.partnerIds.length ? `${r.partnerIds.length} partner(s)` : partnerName(r.partnerId));
  return (
    <div className="space-y-4">
      <Accordion title="Custom Payout Revenue Settings" count={0} defaultOpen>
        <Note>{LIVE_NOTE}</Note>
        <CollectionTab basePath={`${base}/geo-rules`} addLabel="Add override" emptyText="No custom payout/revenue overrides."
          searchKeys={['country', 'payoutOverride', 'revenueOverride', 'destinationOverride']}
          searchPlaceholder="Search by country…"
          fields={[
            { key: 'country', label: 'Country (ISO-2 or *)', required: true, placeholder: 'US' },
            { key: 'action', label: 'Action', type: 'select', options: ['allow', 'deny'], default: 'allow' },
            { key: 'payoutOverride', label: 'Payout override', type: 'money' },
            { key: 'revenueOverride', label: 'Revenue override', type: 'money' },
            { key: 'destinationOverride', label: 'Destination override', type: 'url' },
          ] as FieldDef[]}
          columns={[col('Country', (r) => String(r.country)), col('Action', (r) => String(r.action)), col('Payout', (r) => num(r.payoutOverride)), col('Revenue', (r) => num(r.revenueOverride))]} />
      </Accordion>

      <Accordion title="Custom Caps Settings" count={0}>
        <CategoryPanel offerId={offerId} category="caps" addLabel="Custom Cap" emptyText="No custom caps."
          extraFields={[
            { key: 'partnerId', label: 'Partner (— = all partners)', type: 'select', options: partnerOptions },
            { key: 'capType', label: 'Cap Type', type: 'select', options: CAP_TYPES, default: 'clicks' },
            { key: 'capInterval', label: 'Cap Window', type: 'select', options: CAP_INTERVALS, default: 'daily' },
            { key: 'capValue', label: 'Cap Value', type: 'number', required: true },
          ]}
          columns={[col('Name', (r) => (r.name ? String(r.name) : '—')), col('Partner', (r) => partnerName(r.partnerId)), col('Cap Type', (r) => (r.capType ? `${String(r.capType)} / ${String(r.capInterval)}` : 'Multiple')), col('Cap Value', (r) => num(r.capValue))]} />
      </Accordion>

      <Accordion title="Custom Throttle Rate Settings" count={0}>
        <CategoryPanel offerId={offerId} category="throttle_rates" addLabel="Throttle Rate" emptyText="No custom throttle rates."
          extraFields={[
            { key: 'partnerId', label: 'Partner (— = all partners)', type: 'select', options: partnerOptions },
            { key: 'throttleRate', label: 'Throttle Rate (%)', type: 'number', required: true },
            { key: 'conversionStatus', label: 'Throttled Conversion Status', type: 'select', options: ['rejected', 'pending'], default: 'rejected' },
          ]}
          columns={[col('Name', (r) => (r.name ? String(r.name) : '—')), col('Partner', (r) => partnerName(r.partnerId)), col('Throttle Rate', (r) => num(r.throttleRate, '%')), col('Status Set', (r) => (r.conversionStatus ? String(r.conversionStatus) : 'rejected'))]} />
      </Accordion>

      <Accordion title="Custom Landing Pages" count={0}>
        <CategoryPanel offerId={offerId} category="landing_pages" addLabel="Landing Page" emptyText="No custom landing pages."
          extraFields={[
            { key: 'partnerIds', label: 'Partners (empty = all)', type: 'multiselect', options: partnerOptions, placeholder: 'Type to search partners…' },
            { key: 'landingPageUrl', label: 'URL', type: 'url', required: true },
          ]}
          columns={[col('Name', (r) => (r.name ? String(r.name) : '—')), col('Partners', partnerCount), col('URL', (r) => (r.landingPageUrl ? String(r.landingPageUrl) : '—'))]} />
      </Accordion>

      <Accordion title="Custom Creatives" count={0}>
        <CategoryPanel offerId={offerId} category="creatives" addLabel="Creative" emptyText="No custom creatives."
          extraFields={[
            { key: 'partnerIds', label: 'Partners (empty = all)', type: 'multiselect', options: partnerOptions, placeholder: 'Type to search partners…' },
            { key: 'creativeType', label: 'Type', type: 'select', options: CREATIVE_TYPES, default: 'image' },
            { key: 'creativeUrl', label: 'Creative URL', type: 'url' },
          ]}
          columns={[col('Name', (r) => (r.name ? String(r.name) : '—')), col('Partners', partnerCount), col('Type', (r) => (r.creativeType ? String(r.creativeType) : '—')), col('Creative', (r) => (r.creativeUrl ? String(r.creativeUrl) : '—'))]} />
      </Accordion>
    </div>
  );
}

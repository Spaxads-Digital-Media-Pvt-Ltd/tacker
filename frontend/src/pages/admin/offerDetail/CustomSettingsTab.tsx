import type { ReactNode } from 'react';
import { CollectionTab, type FieldDef } from '../../../components/CollectionTab';
import { Accordion } from '../../../components/Accordion';
import type { Column } from '../../../components/ui';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const num = (v: unknown, suffix = '') => (v == null || v === '' ? '—' : <span className="tabular-nums">{String(v)}{suffix}</span>);

/** Applied at the click path today (per-country, on offer_geo_rules). */
const LIVE_NOTE = 'These per-country overrides ARE applied at /click — the resolved payout/revenue/destination is frozen onto each click and flows to the ledger.';
/** offer_custom_settings rows — stored, not yet consumed by the click/ledger path. */
const REF_NOTES: Record<string, string> = {
  caps: 'Stored for reference — not applied at the click path yet. The enforced caps are this offer’s own Daily Click / Conversion Cap (General → Tracking & Controls).',
  throttle_rates: 'Stored for reference — traffic throttling is not applied at the click path yet.',
  landing_pages: 'Stored for reference — the click path serves the offer’s Destination URL (or a per-country Destination override above). Custom landing pages here are not served yet.',
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
    { key: 'name', label: 'Name', required: true },
    ...extraFields,
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
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
        searchKeys={['name', 'value', 'event', 'description']}
        searchPlaceholder="Search by name…"
        fields={fields}
        columns={columns}
      />
    </>
  );
}

export function CustomSettingsTab({ base, offerId }: { base: string; offerId: string }) {
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
            { key: 'event', label: 'Cap Type', type: 'select', options: ['Daily Click Cap', 'Daily Conversion Cap', 'Total Conversion Cap'] },
            { key: 'value', label: 'Cap Value', type: 'number' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('Cap Type', (r) => (r.event ? String(r.event) : '—')), col('Cap Value', (r) => num(r.value))]} />
      </Accordion>

      <Accordion title="Custom Throttle Rate Settings" count={0}>
        <CategoryPanel offerId={offerId} category="throttle_rates" addLabel="Throttle Rate" emptyText="No custom throttle rates."
          extraFields={[
            { key: 'value', label: 'Throttle Rate (%)', type: 'number' },
            { key: 'description', label: 'Redirect URL', type: 'url' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('Throttle Rate', (r) => num(r.value, '%')), col('Redirect', (r) => (r.description ? String(r.description) : '—'))]} />
      </Accordion>

      <Accordion title="Custom Landing Pages" count={0}>
        <CategoryPanel offerId={offerId} category="landing_pages" addLabel="Landing Page" emptyText="No custom landing pages."
          extraFields={[
            { key: 'value', label: 'URL', type: 'url' },
            { key: 'event', label: 'Weight', type: 'number' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('URL', (r) => (r.value ? String(r.value) : '—')), col('Weight', (r) => num(r.event))]} />
      </Accordion>

      <Accordion title="Custom Creatives" count={0}>
        <CategoryPanel offerId={offerId} category="creatives" addLabel="Creative" emptyText="No custom creatives."
          extraFields={[
            { key: 'value', label: 'Creative' },
            { key: 'event', label: 'Weight', type: 'number' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('Creative', (r) => (r.value ? String(r.value) : '—')), col('Weight', (r) => num(r.event))]} />
      </Accordion>
    </div>
  );
}

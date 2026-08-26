import type { ReactNode } from 'react';
import { CollectionTab, type FieldDef } from '../../../components/CollectionTab';
import { Accordion } from '../../../components/Accordion';
import type { Column } from '../../../components/ui';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });

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
    <CollectionTab
      basePath="/api/offer-custom-settings"
      listPath={`/api/offer-custom-settings?category=${category}&offerId=${offerId}`}
      addLabel={addLabel}
      emptyText={emptyText}
      editable
      fields={fields}
      columns={columns}
    />
  );
}

export function CustomSettingsTab({ base, offerId }: { base: string; offerId: string }) {
  return (
    <div className="space-y-4">
      <Accordion title="Custom Payout Revenue Settings" count={0} defaultOpen>
        <CollectionTab basePath={`${base}/geo-rules`} addLabel="Add override" emptyText="No custom payout/revenue overrides."
          fields={[
            { key: 'country', label: 'Country (ISO-2 or *)', required: true, placeholder: 'US' },
            { key: 'action', label: 'Action', type: 'select', options: ['allow', 'deny'], default: 'allow' },
            { key: 'payoutOverride', label: 'Payout override', type: 'money' },
            { key: 'revenueOverride', label: 'Revenue override', type: 'money' },
            { key: 'destinationOverride', label: 'Destination override', type: 'url' },
          ] as FieldDef[]}
          columns={[col('Country', (r) => String(r.country)), col('Action', (r) => String(r.action)), col('Payout', (r) => String(r.payoutOverride ?? '—')), col('Revenue', (r) => String(r.revenueOverride ?? '—'))]} />
      </Accordion>

      <Accordion title="Custom Caps Settings" count={0}>
        <CategoryPanel offerId={offerId} category="caps" addLabel="Custom Cap" emptyText="No custom caps."
          extraFields={[
            { key: 'event', label: 'Cap Type', type: 'select', options: ['Daily Click Cap', 'Daily Conversion Cap', 'Total Conversion Cap'] },
            { key: 'value', label: 'Cap Value', type: 'number' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('Cap Type', (r) => (r.event ? String(r.event) : '—')), col('Cap Value', (r) => (r.value ? String(r.value) : '—'))]} />
      </Accordion>

      <Accordion title="Custom Throttle Rate Settings" count={0}>
        <CategoryPanel offerId={offerId} category="throttle_rates" addLabel="Throttle Rate" emptyText="No custom throttle rates."
          extraFields={[
            { key: 'value', label: 'Throttle Rate (%)', type: 'number' },
            { key: 'description', label: 'Redirect URL', type: 'url' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('Throttle Rate', (r) => (r.value ? `${r.value}%` : '—')), col('Redirect', (r) => (r.description ? String(r.description) : '—'))]} />
      </Accordion>

      <Accordion title="Custom Landing Pages" count={0}>
        <CategoryPanel offerId={offerId} category="landing_pages" addLabel="Landing Page" emptyText="No custom landing pages."
          extraFields={[
            { key: 'value', label: 'URL', type: 'url' },
            { key: 'event', label: 'Weight', type: 'number' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('URL', (r) => (r.value ? String(r.value) : '—')), col('Weight', (r) => (r.event ? String(r.event) : '—'))]} />
      </Accordion>

      <Accordion title="Custom Creatives" count={0}>
        <CategoryPanel offerId={offerId} category="creatives" addLabel="Creative" emptyText="No custom creatives."
          extraFields={[
            { key: 'value', label: 'Creative' },
            { key: 'event', label: 'Weight', type: 'number' },
          ]}
          columns={[col('Name', (r) => String(r.name)), col('Creative', (r) => (r.value ? String(r.value) : '—')), col('Weight', (r) => (r.event ? String(r.event) : '—'))]} />
      </Accordion>
    </div>
  );
}

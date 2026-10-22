/**
 * Shared bits of My partners / My advertisers: the date range (this month by default — the API answers
 * with the range it used), money per currency (never summed across currencies), the latest-conversions table.
 */
import { money } from '../../../lib/platformBilling';
import type { LatestConversion } from '../../../lib/myPanels';
import { Table } from '../../../shared-components/primitives/ui';

export function RangePicker({ value, onChange }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-small text-fg-secondary">
      <label>From <input type="date" className="input ml-1 !w-auto" value={value.from} max={value.to || undefined} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} /></label>
      <label>To <input type="date" className="input ml-1 !w-auto" value={value.to} min={value.from || undefined} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} /></label>
    </div>
  );
}

export function LatestConversions({ rows, showPartner }: { rows: LatestConversion[]; showPartner?: boolean }) {
  if (!rows.length) return <p className="text-small text-fg-muted">No conversions in the last 30 days.</p>;
  return (
    <Table rowKey={(c) => c.id} rows={rows} columns={[
      { header: 'When', cell: (c) => <span className="whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</span> },
      { header: 'Offer', cell: (c) => c.offer_name },
      ...(showPartner ? [{ header: 'Partner', cell: (c: LatestConversion) => c.publisher_name ?? '—' }] : []),
      { header: 'Status', cell: (c) => <span className="capitalize">{c.status}</span> },
      { header: 'Event', cell: (c) => c.event_name ?? '—' },
      { header: 'Payout', cell: (c) => (c.payout && c.currency ? money(c.payout, c.currency) : '—') },
      { header: 'Revenue', cell: (c) => (c.revenue && c.currency ? money(c.revenue, c.currency) : '—') },
      { header: 'Country', cell: (c) => c.country ?? '—' },
    ]} />
  );
}

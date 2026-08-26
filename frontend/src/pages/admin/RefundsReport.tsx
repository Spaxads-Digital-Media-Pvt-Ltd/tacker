/**
 * Reporting › Refunds — verified against the live reference (URL `/reporting/refund`, empty on their
 * demo account too — 0 Total). Columns: Conversion Status | Refund Date | Offer | Partner |
 * Advertiser | Revenue | Payout | Store | SKUs | Transaction ID | Conversion ID | Date | Email |
 * Refund Amount | Sale Amount | Order ID | Coupon Code | Offer URL — same date-range/Add Filter/Run
 * Report shell as every other report.
 *
 * Same category as Products Report (ProductsReport.tsx): the nav's own description says "Refunds
 * from connected stores," and this data is native to real e-commerce platform integrations
 * (WooCommerce, ClickFunnels, Stripe, Shopify) this app doesn't have — no Store/SKU/Order/Coupon/
 * refund concept exists anywhere in this schema. Follows the same honest-shell pattern as
 * PartnerReferralsReport.tsx and ProductsReport.tsx (components/EmptyShellTable.tsx): the real
 * column structure, genuinely empty, inert "Not available yet" controls instead of live filtering
 * that doesn't exist.
 */
import { Filter, MoreVertical } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';

const COLUMNS = [
  'Conversion Status', 'Refund Date', 'Offer', 'Partner', 'Advertiser', 'Revenue', 'Payout',
  'Store', 'SKUs', 'Transaction ID', 'Conversion ID', 'Date', 'Email',
  'Refund Amount', 'Sale Amount', 'Order ID', 'Coupon Code', 'Offer URL',
];

export default function RefundsReport() {
  return (
    <>
      <PageHeader title="Refunds Report" subtitle="Reporting › Refunds" action={
        <button title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label mb-1 block">From</label>
            <input title="Not available yet" type="date" className="input" defaultValue="" />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input title="Not available yet" type="date" className="input" defaultValue="" />
          </div>
          <button title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <Filter size={15} />
          </button>
          <div className="flex-1" />
          <button title="Not available yet" className="btn-primary">Run Report</button>
        </div>
      </div>

      <div className="card mb-4">
        <p className="text-small text-fg-muted">
          Refunds aren't available yet — this data comes from a WooCommerce, ClickFunnels, Stripe, or Shopify integration, none of which this network has connected. See Connect › Integrations.
        </p>
      </div>

      <div className="card">
        <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
        <EmptyShellTable columns={COLUMNS} search={false} />
      </div>
    </>
  );
}

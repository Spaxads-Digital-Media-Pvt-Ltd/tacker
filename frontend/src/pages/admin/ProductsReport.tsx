/**
 * Reporting › Products — verified against the live reference (URL `/reporting/product`, empty on
 * their demo account too — 0 Total). Columns: SKU (expandable by Partner) | Total CV | CV | VT CV |
 * Throttle | Event | Gross Sales, same date-range/Add Filter/Run Report shell as every other report.
 *
 * This app has no product/SKU concept anywhere — no order-line-item tracking, and (per the
 * reference's own adjacent "Refunds" nav entry, "View refund data from WooCommerce, ClickFunnels,
 * Stripe, and/or Shopify integrations") this data is native to Everflow's real e-commerce platform
 * integrations, which this app doesn't have (confirmed: no Shopify/WooCommerce/SKU concept anywhere
 * in the schema). Rather than fabricate SKU rows, this follows the same honest-shell pattern already
 * established for Partner Referrals (PartnerReferralsReport.tsx) and elsewhere in the app
 * (components/EmptyShellTable.tsx) — the real column structure, genuinely empty, with inert
 * "Not available yet" controls instead of live filtering that doesn't exist.
 */
import { Filter, MoreVertical } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';

const COLUMNS = ['SKU / Partner', 'Total CV', 'CV', 'VT CV', 'Throttle', 'Event', 'Gross Sales'];

export default function ProductsReport() {
  return (
    <>
      <PageHeader title="Products Report" subtitle="Reporting › Products" action={
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
          Product/SKU-level tracking isn't available yet — this data comes from a WooCommerce, ClickFunnels, Stripe, or Shopify integration, none of which this network has connected. See Connect › Integrations.
        </p>
      </div>

      <div className="card">
        <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
        <EmptyShellTable columns={COLUMNS} search={false} />
      </div>
    </>
  );
}

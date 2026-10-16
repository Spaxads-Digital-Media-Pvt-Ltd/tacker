/**
 * The bar across the top of a network's dashboard (staff) while one of the platform's invoices to it is
 * overdue: which invoice, and the date the network is suspended if it's still unpaid — with the way to
 * Billing (how to pay, the invoice itself).
 */
import { Link } from 'react-router-dom';
import { money, day } from '../../lib/platformBilling';
import type { OverdueInvoice } from '../../lib/useNetworkBranding';

export function OverdueInvoiceBanner({ invoice }: { invoice: OverdueInvoice }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/30 bg-danger-bg px-4 py-2 text-small text-danger-text">
      <span>
        Invoice <strong>{invoice.number}</strong> ({money(invoice.total, invoice.currency)}) is overdue — please pay it by{' '}
        <strong>{day(invoice.suspend_at)}</strong> to keep tracking, this dashboard and the API running.
      </span>
      <Link to="/app/billing" className="btn-ghost !py-1">View billing</Link>
    </div>
  );
}

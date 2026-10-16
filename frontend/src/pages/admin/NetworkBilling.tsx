/**
 * Control Center › Billing — the network's own plan and bill (staff only; GET /api/subscription): its plan
 * and subscription, this period's usage against the plan's limits, the platform's invoices to it, and how
 * to pay them. An overdue invoice is called out with the date the network would be suspended. Plans are
 * changed by the platform administrator.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import { PlanLimitBars } from '../../shared-components/panels/PlanLimitBars';
import { money, planPrice, day, invoiceState, billingBadge, type PlatformInvoice, type BillingSettings } from '../../lib/platformBilling';
import type { PlanLimitStatus } from '../../types';

interface TenantBilling {
  subscription: {
    status: string; plan_code: string; plan_name: string; price_cents: number; currency: string; billing_interval: 'month' | 'year';
    current_period_start: string | null; current_period_end: string | null; trial_ends_at: string | null;
    cancel_at_period_end: boolean; canceled_at: string | null;
  } | null;
  period: { start: string; end: string };
  limits: PlanLimitStatus[];
  invoices: PlatformInvoice[];
  billing: { paymentInstructions: string; seller: BillingSettings['seller'] };
}

export default function NetworkBilling() {
  const { data, loading, error } = useQuery<TenantBilling>('/api/subscription');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !data) return <StateBlock>{error ?? 'Could not load billing'}</StateBlock>;
  const sub = data.subscription;
  const overdue = data.invoices.filter((i) => i.status === 'open' && i.overdue);
  const open = data.invoices.filter((i) => i.status === 'open');

  const columns: Column<PlatformInvoice>[] = [
    { header: 'Invoice', cell: (i) => <Link to={`/app/billing/invoices/${i.id}`} className="font-mono text-xs text-fg hover:text-accent-text hover:underline">{i.number}</Link> },
    { header: 'Description', cell: (i) => <span className="text-small text-fg-secondary">{i.description}</span> },
    { header: 'Total', className: 'text-right', cell: (i) => <span className="whitespace-nowrap font-medium">{money(i.total, i.currency)}</span> },
    { header: 'Issued', cell: (i) => day(i.issued_at) },
    { header: 'Due', cell: (i) => day(i.due_at) },
    { header: 'Status', cell: (i) => <Badge {...billingBadge(invoiceState(i))} /> },
  ];

  return (
    <>
      <PageHeader title="Billing" subtitle="Your plan, usage and invoices." />
      {overdue.length > 0 && (
        <div role="alert" className="mb-4 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text">
          {overdue.map((i) => (
            <p key={i.id}>
              Invoice <strong>{i.number}</strong> ({money(i.total, i.currency)}) is overdue. Please pay it by <strong>{day(i.suspend_at)}</strong> — after that,
              tracking, this dashboard and the API are suspended until it is paid.
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="text-h3 font-medium text-fg">Plan</h3>
          {sub ? (
            <>
              <p className="text-small text-fg"><span className="font-semibold">{sub.plan_name}</span> · {planPrice(sub)}</p>
              <p className="flex flex-wrap items-center gap-2 text-small text-fg-secondary">
                <Badge {...billingBadge(sub.status)} />
                {sub.status === 'trialing' && <span>Free trial until {day(sub.trial_ends_at)}</span>}
                {(sub.status === 'active' || sub.status === 'past_due') && (
                  <span>{sub.cancel_at_period_end ? `Ends on ${day(sub.current_period_end)}` : `Renews on ${day(sub.current_period_end)}`}</span>
                )}
                {sub.status === 'canceled' && <span>Ended {day(sub.canceled_at)}</span>}
              </p>
            </>
          ) : <p className="text-small text-fg-secondary">No plan yet.</p>}
          <p className="text-tiny text-fg-muted">To change your plan, contact the platform administrator.</p>
        </div>
        <div className="card">
          <h3 className="text-h3 font-medium text-fg">Usage this period</h3>
          <p className="text-tiny text-fg-muted">{day(data.period.start)} – {day(data.period.end)}</p>
          {data.limits.length === 0
            ? <p className="mt-2 text-small text-fg-secondary">{sub ? 'Your plan sets no usage limits.' : 'Usage is compared with your plan’s limits once you have one.'}</p>
            : <PlanLimitBars limits={data.limits} />}
        </div>
      </div>

      {open.length > 0 && data.billing.paymentInstructions && (
        <div className="card mt-4">
          <h3 className="text-h3 font-medium text-fg">How to pay</h3>
          <p className="mt-2 whitespace-pre-line text-small text-fg">{data.billing.paymentInstructions}</p>
          <p className="mt-2 text-tiny text-fg-secondary">Quote the invoice number with your payment. It is marked paid once received.</p>
        </div>
      )}

      <h2 className="mb-3 mt-6 text-small font-semibold uppercase tracking-wide text-fg-secondary">Invoices</h2>
      {data.invoices.length === 0 ? <StateBlock>No invoices yet.</StateBlock> : <Table columns={columns} rows={data.invoices} rowKey={(i) => i.id} />}
    </>
  );
}

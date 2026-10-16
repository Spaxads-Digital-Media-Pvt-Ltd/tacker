/**
 * The printed copy of a platform invoice (the platform billing a tenant network) — the Super Admin's
 * Billing › View and the tenant's Settings › Billing › View show the same document. "Print / Save as PDF"
 * uses the browser's print dialog; the page chrome is hidden when printing.
 */
import { type ReactNode } from 'react';
import { Badge } from '../primitives/ui';
import { money, day, invoiceState, paymentMethodLabel, billingBadge, type InvoiceDocumentData } from '../../lib/platformBilling';

function Line({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 text-small ${strong ? 'border-t border-border pt-2 font-semibold text-fg' : 'text-fg-secondary'}`}>
      <span>{label}</span><span className={strong ? '' : 'text-fg'}>{children}</span>
    </div>
  );
}

export function InvoiceDocument({ data, actions }: { data: InvoiceDocumentData; actions?: ReactNode }) {
  const { invoice: inv, seller, paymentInstructions } = data;
  const state = invoiceState(inv);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2 print:hidden">
        {actions}
        <button type="button" className="btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="card space-y-6 !p-8 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-h3 font-semibold text-fg">{seller.name || 'Invoice'}</p>
            {seller.address && <p className="mt-1 whitespace-pre-line text-small text-fg-secondary">{seller.address}</p>}
            {seller.taxId && <p className="text-small text-fg-secondary">Tax ID: {seller.taxId}</p>}
            {seller.email && <p className="text-small text-fg-secondary">{seller.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-h1 font-bold tracking-tight text-fg">INVOICE</p>
            <p className="font-mono text-small text-fg">{inv.number}</p>
            <div className="mt-2"><Badge {...billingBadge(state)} /></div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">Bill to</p>
            <p className="mt-1 font-medium text-fg">{inv.bill_to?.name ?? '—'}</p>
            {inv.bill_to?.email && <p className="text-small text-fg-secondary">{inv.bill_to.email}</p>}
          </div>
          <div className="text-small sm:text-right">
            <p><span className="text-fg-secondary">Issued:</span> {day(inv.issued_at)}</p>
            <p><span className="text-fg-secondary">Due:</span> {day(inv.due_at)}</p>
            {inv.period_start && <p><span className="text-fg-secondary">Period:</span> {day(inv.period_start)} – {day(inv.period_end)}</p>}
          </div>
        </section>

        <section>
          <div className="flex justify-between border-b border-border pb-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted">
            <span>Description</span><span>Amount</span>
          </div>
          {(data.lines?.length ? data.lines : [{ kind: 'one_off' as const, description: inv.description, quantity: '1', unit_amount: inv.subtotal, amount: inv.subtotal }]).map((l, i) => (
            <div key={i} className={`flex justify-between gap-6 border-b border-border/60 py-3 text-small last:border-0 ${l.kind === 'discount' ? 'text-success-text' : 'text-fg'}`}>
              <span>{l.description}{l.kind === 'overage' && <span className="ml-1 text-tiny text-fg-muted">(overage)</span>}</span>
              <span className="whitespace-nowrap">{money(l.amount, inv.currency)}</span>
            </div>
          ))}
          <div className="ml-auto max-w-xs">
            <Line label="Subtotal">{money(inv.subtotal, inv.currency)}</Line>
            <Line label={`Tax${inv.tax_rate && Number(inv.tax_rate) > 0 ? ` (${inv.tax_rate}%)` : ''}`}>{money(inv.tax, inv.currency)}</Line>
            <Line label="Total" strong>{money(inv.total, inv.currency)}</Line>
          </div>
        </section>

        {inv.status === 'paid' ? (
          <p className="rounded-[var(--radius)] bg-success-bg px-4 py-3 text-small text-success-text">
            Paid {money(inv.paid_amount ?? inv.total, inv.currency)} on {day(inv.paid_at)} by {paymentMethodLabel(inv.payment_method)}
            {inv.payment_reference ? ` (reference ${inv.payment_reference})` : ''}. Thank you.
          </p>
        ) : inv.status === 'void' ? (
          <p className="rounded-[var(--radius)] bg-page px-4 py-3 text-small text-fg-secondary">This invoice was voided{inv.void_reason ? `: ${inv.void_reason}` : ''}. Nothing is owed on it.</p>
        ) : paymentInstructions ? (
          <div className="rounded-[var(--radius)] border border-border px-4 py-3">
            <p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">How to pay</p>
            <p className="mt-1 whitespace-pre-line text-small text-fg">{paymentInstructions}</p>
            <p className="mt-2 text-tiny text-fg-secondary">Please quote {inv.number} with your payment.</p>
          </div>
        ) : null}

        {(data.creditNotes ?? []).length > 0 && (
          <section className="rounded-[var(--radius)] border border-border px-4 py-3">
            <p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">Credit notes</p>
            {data.creditNotes!.map((c) => (
              <div key={c.number} className="mt-1 flex justify-between gap-6 text-small">
                <span className="text-fg"><span className="font-mono">{c.number}</span> · {c.reason}{c.refunded ? ' · refunded' : ''} · {day(c.created_at)}</span>
                <span className="whitespace-nowrap text-success-text">−{money(c.amount, c.currency)}</span>
              </div>
            ))}
          </section>
        )}

        {inv.notes && <p className="whitespace-pre-line text-small text-fg-secondary">{inv.notes}</p>}
      </article>
    </div>
  );
}

/**
 * A quote as a document — the same on the prospect's page (/quote/:token) and in Super Admin › Sales:
 * who it's for, the lines, discount, tax and total, the billing interval, valid until, notes and terms.
 * Amounts are text (money()); nothing is recomputed here.
 */
import type { ReactNode } from 'react';
import { money } from '../../lib/platformBilling';
import { BRAND } from '../../config/branding';
import { QUOTE_STATUS, intervalSuffix, type QuoteLine, type QuoteStatus } from '../../lib/platformSales';

export interface QuoteDocumentData {
  number: string; title: string; company: string; contactName?: string | null; currency: string; lines: QuoteLine[];
  subtotal: string; discountPct: string; discount: string; taxRate: string; tax: string; total: string;
  billingInterval: string; notes: string | null; terms: string | null; validUntil: string; status: QuoteStatus;
  preparedBy?: { name: string; email: string | null } | null;
}

const pct = (v: string) => `${Number(v)}%`;

export function QuoteDocument({ q, children }: { q: QuoteDocumentData; children?: ReactNode }) {
  const st = QUOTE_STATUS[q.status];
  return (
    <article className="card space-y-6 !p-8 print:border-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-h3 font-semibold text-fg">{BRAND.name}</p>
          {q.preparedBy && <p className="mt-1 text-small text-fg-secondary">Prepared by {q.preparedBy.name}{q.preparedBy.email ? ` · ${q.preparedBy.email}` : ''}</p>}
        </div>
        <div className="text-right">
          <p className="text-h1 font-bold tracking-tight text-fg">QUOTE</p>
          <p className="font-mono text-small text-fg">Q-{q.number}</p>
          <span className={`mt-2 inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold ${st.chip}`}>{st.label}</span>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">For</p>
          <p className="mt-1 font-medium text-fg">{q.company}</p>
          {q.contactName && <p className="text-small text-fg-secondary">{q.contactName}</p>}
        </div>
        <div className="text-small sm:text-right">
          <p className="font-medium text-fg">{q.title}</p>
          <p><span className="text-fg-secondary">Valid until:</span> {q.validUntil}</p>
        </div>
      </section>

      <section>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 border-b border-border pb-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted">
          <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
        </div>
        {q.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 border-b border-border/60 py-3 text-small text-fg last:border-0">
            <span>{l.description}</span>
            <span className="text-right">{l.quantity.toLocaleString()}</span>
            <span className="whitespace-nowrap text-right">{money(l.unitPrice, q.currency)}</span>
            <span className="whitespace-nowrap text-right">{money(l.amount, q.currency)}</span>
          </div>
        ))}
      </section>

      <section className="ml-auto w-full max-w-xs space-y-1.5 text-small">
        <div className="flex justify-between"><span className="text-fg-secondary">Subtotal</span><span>{money(q.subtotal, q.currency)}</span></div>
        {Number(q.discount) > 0 && <div className="flex justify-between text-success-text"><span>Discount ({pct(q.discountPct)})</span><span>−{money(q.discount, q.currency)}</span></div>}
        {Number(q.taxRate) > 0 && <div className="flex justify-between"><span className="text-fg-secondary">Tax ({pct(q.taxRate)})</span><span>{money(q.tax, q.currency)}</span></div>}
        <div className="flex justify-between border-t border-border pt-2 text-h3 font-semibold text-fg">
          <span>Total</span><span>{money(q.total, q.currency)}</span>
        </div>
        <p className="text-right text-tiny text-fg-muted">{intervalSuffix(q.billingInterval)}</p>
      </section>

      {q.notes && <section><p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">Notes</p><p className="mt-1 whitespace-pre-wrap text-small text-fg">{q.notes}</p></section>}
      {q.terms && <section><p className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">Terms</p><p className="mt-1 whitespace-pre-wrap text-small text-fg-secondary">{q.terms}</p></section>}
      {children}
    </article>
  );
}

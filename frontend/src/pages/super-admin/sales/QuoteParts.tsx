/**
 * Super Admin › Sales › quotes — the form (lines, discount, tax, interval, valid until; totals previewed as
 * you type, saved by the API), the quote itself with what can be done to it (edit / delete a draft, send or
 * re-send, copy the prospect's link, mark accepted or declined, duplicate), and a compact list.
 */
import { useState, type FormEvent } from 'react';
import { Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { money } from '../../../lib/platformBilling';
import { relTime } from '../../../lib/relativeTime';
import { INTERVALS, QUOTE_STATUS, intervalSuffix, previewQuoteTotals, type BillingInterval, type Lead, type Quote } from '../../../lib/platformSales';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { Field, Modal, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { QuoteDocument, type QuoteDocumentData } from '../../../shared-components/panels/QuoteDocument';

const toDoc = (q: Quote, contactName?: string | null): QuoteDocumentData => ({
  number: q.number, title: q.title, company: q.company ?? '', contactName, currency: q.currency, lines: q.lines,
  subtotal: q.subtotal, discountPct: q.discount_pct, discount: q.discount, taxRate: q.tax_rate, tax: q.tax, total: q.total,
  billingInterval: q.billing_interval, notes: q.notes, terms: q.terms, validUntil: q.valid_until, status: q.status,
});

export function QuoteChip({ status }: { status: Quote['status'] }) {
  const s = QUOTE_STATUS[status];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-tiny font-semibold ${s.chip}`}>{s.label}</span>;
}

const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

interface LineDraft { description: string; quantity: string; unitPrice: string }

/** New quote for `lead`, or edit the draft `quote`. */
export function QuoteForm({ lead, quote, onClose, onSaved }: { lead: Pick<Lead, 'id' | 'currency' | 'plan_name' | 'expected_mrr'>; quote?: Quote; onClose: () => void; onSaved: (q: Quote) => void }) {
  const [f, setF] = useState(() => ({
    title: quote?.title ?? `${lead.plan_name ?? 'Subscription'} plan`,
    currency: quote?.currency ?? lead.currency,
    billingInterval: (quote?.billing_interval ?? 'month') as BillingInterval,
    validUntil: quote?.valid_until ?? inDays(30),
    discountPct: quote ? String(Number(quote.discount_pct)) : '0',
    taxRate: quote ? String(Number(quote.tax_rate)) : '0',
    notes: quote?.notes ?? '',
    terms: quote?.terms ?? '',
  }));
  const [lines, setLines] = useState<LineDraft[]>(() => quote
    ? quote.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: l.unitPrice }))
    : [{ description: `${lead.plan_name ?? 'Platform'} plan`, quantity: '1', unitPrice: lead.expected_mrr ?? '' }]);
  const save = useMutation((b: Record<string, unknown>) => (quote ? api.patch<Quote>(`/platform/sales/quotes/${quote.id}`, b) : api.post<Quote>(`/platform/sales/leads/${lead.id}/quotes`, b)));
  const totals = previewQuoteTotals(lines, f.discountPct, f.taxRate);
  const setLine = (i: number, k: keyof LineDraft, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await save.run({
      ...f, currency: f.currency.trim().toUpperCase(), notes: f.notes, terms: f.terms,
      lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: l.unitPrice.trim() })),
    });
    if (out) onSaved(out);
  };
  return (
    <Modal open onClose={onClose} title={quote ? `Edit quote Q-${quote.number}` : 'New quote'} size="xl"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="quote-form" className="btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : quote ? 'Save draft' : 'Create draft'}</button></>}>
      <form id="quote-form" onSubmit={submit} className="space-y-4">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Field label="Title"><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
          <Field label="Currency"><input className="input font-mono uppercase" required maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
          <Field label="Billed">
            <select className="input" value={f.billingInterval} onChange={(e) => setF({ ...f, billingInterval: e.target.value as BillingInterval })}>
              {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <div className="mb-1 grid grid-cols-[1fr_5rem_8rem_2rem] gap-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted">
            <span>Description</span><span>Qty</span><span>Unit price</span><span />
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_8rem_2rem] items-center gap-2">
                <input className="input" required maxLength={300} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} aria-label={`Line ${i + 1} description`} />
                <input className="input" required inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} aria-label={`Line ${i + 1} quantity`} />
                <input className="input font-mono" required inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} aria-label={`Line ${i + 1} unit price`} />
                <button type="button" className="grid h-8 w-8 place-items-center rounded text-fg-muted hover:bg-danger-bg hover:text-danger-text disabled:opacity-40" disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          {lines.length < 50 && <button type="button" className="mt-2 inline-flex items-center gap-1 text-small font-medium text-accent-text hover:underline" onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', unitPrice: '' }])}><Plus size={14} />Add a line</button>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Discount %"><input className="input" inputMode="decimal" value={f.discountPct} onChange={(e) => setF({ ...f, discountPct: e.target.value })} /></Field>
          <Field label="Tax %"><input className="input" inputMode="decimal" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} /></Field>
          <Field label="Valid until"><input className="input" type="date" required value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></Field>
        </div>
        <div className="rounded-[var(--radius)] bg-page px-4 py-3 text-small ring-1 ring-inset ring-border">
          {totals ? (
            <div className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1">
              <span className="text-fg-secondary">Subtotal {money(totals.subtotal, f.currency.toUpperCase())}</span>
              {Number(totals.discount) > 0 && <span className="text-success-text">Discount −{money(totals.discount, f.currency.toUpperCase())}</span>}
              {Number(totals.tax) > 0 && <span className="text-fg-secondary">Tax {money(totals.tax, f.currency.toUpperCase())}</span>}
              <span className="text-h3 font-semibold text-fg">Total {money(totals.total, f.currency.toUpperCase())} <span className="text-tiny font-normal text-fg-muted">{intervalSuffix(f.billingInterval)}</span></span>
            </div>
          ) : <p className="text-right text-fg-muted">Enter whole quantities and amounts like 499 or 499.50 to see the total.</p>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Notes (shown to them)"><textarea className="input min-h-[80px]" maxLength={5000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Field label="Terms"><textarea className="input min-h-[80px]" maxLength={5000} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="e.g. 12-month term, billed monthly in advance." /></Field>
        </div>
      </form>
    </Modal>
  );
}

function SendQuote({ quote, defaultTo, onClose, onSent }: { quote: Quote; defaultTo: string | null; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState(quote.sent_to ?? defaultTo ?? '');
  const [message, setMessage] = useState('');
  const send = useMutation((b: { to: string; message: string }) => api.post<Quote>(`/platform/sales/quotes/${quote.id}/send`, b));
  return (
    <Modal open onClose={onClose} title={`${quote.status === 'sent' ? 'Re-send' : 'Send'} quote Q-${quote.number}`}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={send.busy || !to.trim()} onClick={async () => { if (await send.run({ to: to.trim(), message: message.trim() })) onSent(); }}>{send.busy ? 'Sending…' : 'Send'}</button></>}>
      <div className="space-y-3">
        {send.error && <p className="text-small text-danger-text">{send.error}</p>}
        <Field label="To"><input className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Message (optional)"><textarea className="input min-h-[90px]" maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi — here's the quote we discussed." /></Field>
        <p className="text-tiny text-fg-muted">They get a link to the quote, where they can accept or decline it until {quote.valid_until}.</p>
      </div>
    </Modal>
  );
}

function MarkQuote({ quote, decision, onClose, onDone }: { quote: Quote; decision: 'accepted' | 'declined'; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const mark = useMutation((b: Record<string, string>) => api.post<Quote>(`/platform/sales/quotes/${quote.id}/mark`, b));
  return (
    <Modal open onClose={onClose} title={`Mark Q-${quote.number} ${decision}`}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className={decision === 'accepted' ? 'btn-primary' : 'btn-danger'} disabled={mark.busy}
          onClick={async () => { if (await mark.run({ decision, ...(name.trim() ? { name: name.trim() } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) })) onDone(); }}>
          {mark.busy ? 'Saving…' : decision === 'accepted' ? 'Mark accepted' : 'Mark declined'}</button></>}>
      <div className="space-y-3">
        {mark.error && <p className="text-small text-danger-text">{mark.error}</p>}
        <p className="text-small text-fg-secondary">For an answer given another way (a call, an email). It lands on the lead’s timeline.</p>
        <Field label="Who answered (optional)"><input className="input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {decision === 'declined' && <Field label="Why (optional)"><textarea className="input min-h-[70px]" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

/** One quote: the document and what can be done to it. */
export function QuoteModal({ id, lead, canEdit, onClose, onChanged }: {
  id: string; lead?: Pick<Lead, 'id' | 'currency' | 'plan_name' | 'expected_mrr' | 'email' | 'contact_name'>; canEdit: boolean;
  onClose: () => void; onChanged: (openId?: string) => void;
}) {
  const q = useQuery<Quote>(`/platform/sales/quotes/${id}`);
  const confirm = useConfirm();
  const [mode, setMode] = useState<null | 'edit' | 'send' | 'accepted' | 'declined'>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setMode(null); q.refetch(); onChanged(); };
  const quote = q.data;
  // Opened from the Quotes list there's no lead loaded — a draft's edit needs only the quote itself.
  const forLead = lead ?? (quote ? { id: quote.lead_id, currency: quote.currency, plan_name: null, expected_mrr: null, email: null, contact_name: null } : undefined);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'That didn’t work'); } };
  return (
    <Modal open onClose={onClose} title={quote ? `Quote Q-${quote.number}` : 'Quote'} size="xl">
      {q.loading && !quote ? <StateBlock><Spinner /></StateBlock> : q.error || !quote ? <StateBlock>{q.error ?? 'Quote not found'}</StateBlock> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {canEdit && quote.status === 'draft' && <button className="btn-ghost" onClick={() => setMode('edit')}>Edit</button>}
            {canEdit && (quote.status === 'draft' || quote.status === 'sent') && <button className="btn-primary" onClick={() => setMode('send')}>{quote.status === 'sent' ? 'Re-send' : 'Send to the prospect'}</button>}
            {quote.link && (
              <>
                <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => void navigator.clipboard.writeText(quote.link!).then(() => setCopied(true))}><Copy size={14} />{copied ? 'Copied' : 'Copy link'}</button>
                <a className="btn-ghost inline-flex items-center gap-1.5" href={quote.link} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} />Their page</a>
              </>
            )}
            {canEdit && quote.status === 'sent' && (
              <>
                <button className="btn-ghost text-success-text" onClick={() => setMode('accepted')}>Mark accepted</button>
                <button className="btn-ghost text-danger-text" onClick={() => setMode('declined')}>Mark declined</button>
              </>
            )}
            {canEdit && <button className="btn-ghost" onClick={() => void act(async () => { const c = await api.post<Quote>(`/platform/sales/quotes/${quote.id}/duplicate`, {}); onChanged(c.id); })}>Duplicate</button>}
            {canEdit && quote.status === 'draft' && (
              <button className="btn-ghost text-danger-text" onClick={() => confirm({
                title: `Delete draft Q-${quote.number}?`, confirmLabel: 'Delete', destructive: true, message: 'The draft is removed. Sent quotes stay on the record.',
                onConfirm: async () => { await api.del(`/platform/sales/quotes/${quote.id}`); onChanged(); onClose(); },
              })}>Delete</button>
            )}
            <button className="btn-ghost ml-auto" onClick={() => window.print()}>Print</button>
          </div>
          {error && <p className="text-small text-danger-text">{error}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-tiny text-fg-secondary">
            {quote.sent_at && <span>Sent to {quote.sent_to} {relTime(quote.sent_at)}</span>}
            {quote.viewed_at ? <span>Opened {relTime(quote.viewed_at)}</span> : quote.sent_at ? <span>Not opened yet</span> : null}
            {quote.responded_at && <span>{quote.status === 'accepted' ? 'Accepted' : 'Declined'} {relTime(quote.responded_at)}{quote.responder_name ? ` by ${quote.responder_name}` : ''}</span>}
            {quote.decline_reason && <span>“{quote.decline_reason}”</span>}
          </div>
          <QuoteDocument q={toDoc(quote, forLead?.contact_name)} />
        </div>
      )}
      {quote && mode === 'edit' && forLead && <QuoteForm lead={forLead} quote={quote} onClose={() => setMode(null)} onSaved={refresh} />}
      {quote && mode === 'send' && <SendQuote quote={quote} defaultTo={lead?.email ?? null} onClose={() => setMode(null)} onSent={refresh} />}
      {quote && (mode === 'accepted' || mode === 'declined') && <MarkQuote quote={quote} decision={mode} onClose={() => setMode(null)} onDone={refresh} />}
    </Modal>
  );
}

/** A compact list of quotes (a lead's). */
export function QuoteList({ quotes, onOpen, empty }: { quotes: Quote[]; onOpen: (q: Quote) => void; empty: string }) {
  if (!quotes.length) return <p className="px-4 py-3 text-small text-fg-secondary">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {quotes.map((q) => (
        <li key={q.id}>
          <button type="button" onClick={() => onOpen(q)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-page">
            <span className="min-w-0">
              <span className="block truncate text-small font-medium text-fg">Q-{q.number} · {q.title}</span>
              <span className="text-tiny text-fg-muted">{money(q.total, q.currency)} {intervalSuffix(q.billing_interval)} · valid until {q.valid_until}</span>
            </span>
            <QuoteChip status={q.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

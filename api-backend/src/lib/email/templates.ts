/**
 * Transactional email templates (audit F-24). Plain, escaped HTML — every value that isn't the
 * platform's own copy (names, notes, URLs) goes through escapeHtml. Money is shown exactly as stored
 * (decimal text + currency code), never re-computed as a float. The portal invite's template stays in
 * lib/portal-invite.ts with the rest of the invite.
 */
import { escapeHtml as e } from './transactional.js';

const money = (amount: string, currency: string | null) => `${e(amount)} ${e(currency ?? '')}`.trim();

export function balanceRequestEmail(p: {
  networkName: string; partnerName: string; balances: { currency: string; balance: string }[]; loginUrl: string;
}): { subject: string; html: string } {
  const lines = p.balances.map((b) => `<li>${money(b.balance, b.currency)}</li>`).join('');
  return {
    subject: `Your outstanding balance with ${p.networkName}`,
    html: [
      `<p>Hello ${e(p.partnerName)},</p>`,
      `<p>${e(p.networkName)} has an outstanding (approved, not yet paid) balance for you:</p>`,
      `<ul>${lines}</ul>`,
      `<p>Sign in to your partner portal to review it: <a href="${e(p.loginUrl)}">${e(p.loginUrl)}</a></p>`,
    ].join('\n'),
  };
}

export function invoiceIssuedEmail(p: {
  networkName: string; recipientName: string; audience: 'partner' | 'advertiser';
  ref: number | null; periodStart: string; periodEnd: string; amount: string; currency: string | null;
  paymentTerms: string | null; notes: string | null; loginUrl: string;
}): { subject: string; html: string } {
  const what = p.audience === 'partner' ? 'A new invoice for your earnings' : 'A new invoice';
  return {
    subject: `${p.networkName}: invoice${p.ref != null ? ` #${p.ref}` : ''} for ${p.periodStart} – ${p.periodEnd}`,
    html: [
      `<p>Hello ${e(p.recipientName)},</p>`,
      `<p>${what} has been issued by ${e(p.networkName)}.</p>`,
      `<p>Period: ${e(p.periodStart)} – ${e(p.periodEnd)}<br>Amount: ${money(p.amount, p.currency)}`
        + `${p.paymentTerms ? `<br>Payment terms: ${e(p.paymentTerms)}` : ''}</p>`,
      p.notes ? `<p>${e(p.notes)}</p>` : '',
      `<p>See it in your portal: <a href="${e(p.loginUrl)}">${e(p.loginUrl)}</a></p>`,
    ].filter(Boolean).join('\n'),
  };
}

export function offerDetailsEmail(p: {
  networkName: string; partnerName: string;
  offers: { ref: number | null; name: string; payout: string | null; currency: string | null; previewUrl: string | null; trackingLink: string | null }[];
}): { subject: string; html: string } {
  const items = p.offers.map((o) => [
    `<li><strong>${e(o.name)}</strong>${o.ref != null ? ` (#${o.ref})` : ''}`,
    o.payout != null ? `<br>Payout: ${money(o.payout, o.currency)}` : '',
    o.previewUrl ? `<br>Preview: <a href="${e(o.previewUrl)}">${e(o.previewUrl)}</a>` : '',
    o.trackingLink ? `<br>Your tracking link: <code>${e(o.trackingLink)}</code>` : '',
    '</li>',
  ].join('')).join('\n');
  return {
    subject: p.offers.length === 1 ? `${p.networkName}: offer details — ${p.offers[0]!.name}` : `${p.networkName}: details for ${p.offers.length} offers`,
    html: [`<p>Hello ${e(p.partnerName)},</p>`, `<p>${e(p.networkName)} shared these offers with you:</p>`, `<ul>${items}</ul>`].join('\n'),
  };
}

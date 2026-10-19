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

/** Team member invite (O1): their sign-in and a temporary password they must change at first sign-in. */
export function staffInviteEmail(p: {
  networkName: string; name: string; inviterName: string | null; loginUrl: string; email: string; password: string;
}): { subject: string; html: string } {
  return {
    subject: `You've been invited to ${p.networkName}`,
    html: [
      `<p>Hello ${e(p.name)},</p>`,
      `<p>${p.inviterName ? `${e(p.inviterName)} has invited you` : "You've been invited"} to join the <strong>${e(p.networkName)}</strong> team dashboard.</p>`,
      `<p>Sign in at <a href="${e(p.loginUrl)}">${e(p.loginUrl)}</a></p>`,
      `<p>Email: ${e(p.email)}<br>Temporary password: <code>${e(p.password)}</code></p>`,
      `<p>You'll be asked to choose your own password when you first sign in.</p>`,
    ].join('\n'),
  };
}

/** Password reset (O1): a one-time link to choose a new password. */
export function passwordResetEmail(p: { networkName: string; resetUrl: string; expiresInMinutes: number }): { subject: string; html: string } {
  return {
    subject: `Reset your ${p.networkName} password`,
    html: [
      `<p>Hello,</p>`,
      `<p>Someone asked to reset the password for your ${e(p.networkName)} account. If that was you, choose a new password here:</p>`,
      `<p><a href="${e(p.resetUrl)}">Reset my password</a></p>`,
      `<p>The link works once and expires in ${p.expiresInMinutes} minutes. If you didn't ask for this, ignore this email — your password stays the same.</p>`,
    ].join('\n'),
  };
}

// ---- Partner notifications (O11) — one email per partner, through the email queue. ----

const greet = (name: string) => `<p>Hello ${e(name)},</p>`;
const portalLine = (loginUrl: string) => `<p>Sign in to your partner portal: <a href="${e(loginUrl)}">${e(loginUrl)}</a></p>`;

/** Partner Sign-Up Approved / Rejected. */
export function signupDecisionEmail(p: { networkName: string; partnerName: string; approved: boolean; loginUrl: string }): { subject: string; html: string } {
  return p.approved
    ? {
      subject: `Your ${p.networkName} partner account is approved`,
      html: [greet(p.partnerName), `<p>Good news — ${e(p.networkName)} approved your partner application. You can now run offers.</p>`, portalLine(p.loginUrl)].join('\n'),
    }
    : {
      subject: `Your ${p.networkName} partner application`,
      html: [greet(p.partnerName), `<p>Thanks for applying to ${e(p.networkName)}. We're not able to approve your partner application at this time.</p>`].join('\n'),
    };
}

/** Offer Application Approved / Denied. */
export function offerApplicationEmail(p: { networkName: string; partnerName: string; offerName: string; approved: boolean; loginUrl: string }): { subject: string; html: string } {
  return p.approved
    ? {
      subject: `${p.networkName}: you're approved to run ${p.offerName}`,
      html: [greet(p.partnerName), `<p>Your request to run <strong>${e(p.offerName)}</strong> was approved. Your tracking link is in the portal under Offers.</p>`, portalLine(p.loginUrl)].join('\n'),
    }
    : {
      subject: `${p.networkName}: your request for ${p.offerName}`,
      html: [greet(p.partnerName), `<p>Your request to run <strong>${e(p.offerName)}</strong> wasn't approved this time.</p>`].join('\n'),
    };
}

/** Partner Offer Now Available / Now Unavailable. */
export function offerAvailabilityEmail(p: { networkName: string; partnerName: string; offerName: string; available: boolean; loginUrl: string }): { subject: string; html: string } {
  return p.available
    ? {
      subject: `${p.networkName}: ${p.offerName} is available to you`,
      html: [greet(p.partnerName), `<p><strong>${e(p.offerName)}</strong> is now available for you to run.</p>`, portalLine(p.loginUrl)].join('\n'),
    }
    : {
      subject: `${p.networkName}: ${p.offerName} is no longer available`,
      html: [greet(p.partnerName), `<p><strong>${e(p.offerName)}</strong> is no longer available — please stop sending traffic to it. Clicks on its tracking links won't be credited.</p>`, portalLine(p.loginUrl)].join('\n'),
    };
}

/** New Offer Creative Available. */
export function newCreativeEmail(p: { networkName: string; partnerName: string; offerName: string; creativeName: string; loginUrl: string }): { subject: string; html: string } {
  return {
    subject: `${p.networkName}: new creative for ${p.offerName}`,
    html: [greet(p.partnerName), `<p>A new creative, <strong>${e(p.creativeName)}</strong>, is available for <strong>${e(p.offerName)}</strong>.</p>`, portalLine(p.loginUrl)].join('\n'),
  };
}

/** Payout Batch Completed — the partner's own line. */
export function payoutSentEmail(p: { networkName: string; partnerName: string; amount: string; currency: string; reference: string | null; loginUrl: string }): { subject: string; html: string } {
  return {
    subject: `${p.networkName}: payment of ${p.amount} ${p.currency} sent`,
    html: [
      greet(p.partnerName),
      `<p>${e(p.networkName)} has paid you <strong>${money(p.amount, p.currency)}</strong>${p.reference ? ` (${e(p.reference)})` : ''}.</p>`,
      `<p>Your statement in the portal shows the payment.</p>`, portalLine(p.loginUrl),
    ].join('\n'),
  };
}

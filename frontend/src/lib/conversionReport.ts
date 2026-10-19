/**
 * Conversion Report — pure display rules (no React / DOM, so `node --test` runs the real code; see
 * lib/__tests__/conversionReport.test.ts). Used by pages/admin/ConversionReport.tsx.
 */
import { money } from './reportMath.ts';

const DASH = '—';

/** Click → conversion time as "45s", "3m 20s", "26h 5m"; no originating click → "—". */
export function formatDelta(seconds: number | null | undefined): string {
  if (seconds == null) return DASH;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * A conversion's payout / revenue in the currency stored ON the conversion. A conversion recorded
 * without a currency is shown as a plain amount (with a note) — never formatted as an assumed USD.
 */
export function conversionMoney(value: string | null | undefined, currency: string | null | undefined): { text: string; title?: string } {
  if (value == null || value === '') return { text: DASH };
  const n = Number(value);
  if (!Number.isFinite(n)) return { text: value };
  const cur = (currency ?? '').trim();
  if (cur) return { text: money(n, cur) };
  return {
    text: n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    title: 'No currency was recorded on this conversion',
  };
}

/** The Currency cell / export value: the conversion's own currency, or "—" when none was recorded. */
export function conversionCurrency(currency: string | null | undefined): string {
  const cur = (currency ?? '').trim();
  return cur || DASH;
}

/** A conversion's reason (why held / rejected) and why an inbound postback recorded nothing — the
 * codes the tracking surface writes (record.ts, inbound-log.ts) — in words. */
const REASON_LABELS: Record<string, string> = {
  outside_attribution_window: 'Outside the attribution window',
  click_to_conversion_too_fast: 'Click-to-conversion time too short',
  click_to_conversion_too_slow: 'Click-to-conversion time too long',
  partner_not_active: 'Partner not active',
  held_unusual_volume: 'Unusual volume from one click — held for review',
  manual_approval_required: 'Waiting for manual approval',
  custom_throttle: 'Throttled (custom setting)',
  throttled: 'Throttled — no partner payout',
  daily_conversion_cap_reached: 'Over caps — offer daily cap',
  total_conversion_cap_reached: 'Over caps — offer total cap',
  goal_daily_conversion_cap_reached: 'Over caps — event daily cap',
  goal_total_conversion_cap_reached: 'Over caps — event total cap',
  custom_conversion_cap_reached: 'Over caps — partner conversion cap',
  custom_payout_cap_reached: 'Over caps — partner payout cap',
  custom_revenue_cap_reached: 'Over caps — partner revenue cap',
  '24metrics_flagged': '24metrics rejected the click — held for review',
  missing_click_id: 'No click ID sent',
  unknown_coupon: 'Unknown coupon code',
  unknown_impression: 'Impression not found (or view-through off / window over)',
  unknown_email: 'No current owner for this customer’s email',
  unknown_click: 'Click ID not found',
  click_not_owned: 'Click belongs to another advertiser',
  missing_security_code: 'No security code sent',
  wrong_security_code: 'Wrong security code',
  no_security_code_configured: 'No security code set up',
  browser_origin_not_allowed: 'Fired from a page outside the offer’s site',
  duplicate_transaction_id: 'Transaction ID already recorded for this event',
  duplicate_click_event: 'Click already converted on this event',
  repeat_within_60s: 'Identical repeat within 60 seconds (a retry)',
  internal_error: 'Server error — not recorded (the advertiser can retry)',
};

/** The reason in words; an unknown code is shown as sent, no reason → null. */
export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith('postback_control:')) return `Postback control: ${reason.slice('postback_control:'.length)}`;
  return REASON_LABELS[reason] ?? reason;
}

/** What happened to an inbound postback (Advertiser Postback report), in words. */
export const INBOUND_OUTCOME_LABELS: Record<string, string> = {
  approved: 'Approved', pending: 'Pending', rejected: 'Rejected',
  duplicate: 'Duplicate', click_not_found: 'Click not found', security_failed: 'Security failed', error: 'Error',
};

/** True when the request became a conversion (approved / pending / rejected); the rest recorded nothing. */
export function inboundRecorded(outcome: string): boolean {
  return outcome === 'approved' || outcome === 'pending' || outcome === 'rejected';
}

/**
 * Approve / reject move money in the ledger and the API allows them to the `admin` and `finance`
 * roles only (dashboard finance routes, requireRole('admin', 'finance')) — other roles get no
 * controls rather than buttons that fail with 403. Unknown role (still loading) → no controls.
 */
export function canModerateConversions(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'finance';
}

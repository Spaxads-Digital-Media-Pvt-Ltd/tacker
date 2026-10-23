/**
 * Display labels and tones for the offer status enum (backend values: draft / active / paused /
 * archived), shared by the Offers list and Offer Detail. Display only — filter values, request params
 * and sort keys keep sending the raw values.
 */
export const OFFER_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

export type OfferStatusTone = 'success' | 'warning' | 'neutral';

/** Semantic tone per status: the list's status dot and the detail page's Badge both read this. */
export const OFFER_STATUS_TONE: Record<string, OfferStatusTone> = {
  active: 'success',
  paused: 'warning',
  draft: 'neutral',
  archived: 'neutral',
};

/** Status-dot fill per tone. Warning uses --warning-text: plain --warning is 2.15:1 on white. */
export const OFFER_TONE_DOT: Record<OfferStatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning-text',
  neutral: 'bg-fg-muted',
};

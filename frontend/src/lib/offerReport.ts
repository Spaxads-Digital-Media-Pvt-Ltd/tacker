/**
 * Offer Report — pure display / export rules (no React / DOM, so `node --test` runs the real code;
 * see lib/__tests__/offerReport.test.ts). Used by pages/admin/OfferReport.tsx.
 */

export interface OfferLike { name: string; ref?: number | string | null }

/**
 * The Offer cell for a report row. A known offer shows its name (and its numeric ref as the ID); an
 * id the network's offer list doesn't contain (deleted, or not yet loaded) shows the FULL id — an
 * 8-character prefix is ambiguous — and says so in the tooltip; traffic with no offer is `noOfferLabel`.
 */
export function offerDisplay(
  id: string | null, offer: OfferLike | undefined, noOfferLabel: string,
): { name: string; offerId: string; known: boolean; title?: string } {
  if (id == null) return { name: noOfferLabel, offerId: '', known: false, title: 'Traffic not attributed to an offer' };
  if (offer) return { name: offer.name, offerId: offer.ref != null && offer.ref !== '' ? String(offer.ref) : id, known: true, title: `Offer ID ${offer.ref ?? id}` };
  return { name: `Unknown offer (${id})`, offerId: id, known: false, title: 'This offer is not in the network\'s offer list (deleted, or the list is still loading)' };
}

/**
 * A money metric as the exact decimal text the API returned (numeric(14,4) — "12.3456"), never a
 * float re-rounded with toFixed: exports keep the recorded values, like the Click / Conversion exports.
 */
export function exactMoney(metrics: Record<string, string | number | undefined>, key: 'payout' | 'revenue' | 'margin'): string {
  const v = metrics[key];
  if (v == null || v === '') return '0';
  return typeof v === 'number' ? String(v) : v;
}

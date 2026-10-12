/**
 * Advertiser Report — pure display rules (no React / DOM, so `node --test` runs the real code; see
 * lib/__tests__/advertiserReport.test.ts). Offer labels for the drill-down and exact export money
 * reuse lib/offerReport (offerDisplay, exactMoney).
 */

export interface AdvertiserLike { name: string; ref?: number | string | null }

/**
 * The Advertiser cell for a report row: a known advertiser's name with its numeric ref as the ID; an
 * id the advertiser list doesn't contain shows the FULL id (an 8-character prefix is ambiguous) and
 * says why; traffic with no advertiser is `noAdvertiserLabel`.
 */
export function advertiserDisplay(
  id: string | null, advertiser: AdvertiserLike | undefined, noAdvertiserLabel: string,
): { name: string; advertiserId: string; known: boolean; title?: string } {
  if (id == null) return { name: noAdvertiserLabel, advertiserId: '', known: false, title: 'Traffic not attributed to an advertiser' };
  if (advertiser) {
    const ref = advertiser.ref != null && advertiser.ref !== '' ? String(advertiser.ref) : id;
    return { name: advertiser.name, advertiserId: ref, known: true, title: `Advertiser ID ${ref}` };
  }
  return { name: `Unknown advertiser (${id})`, advertiserId: id, known: false, title: 'This advertiser is not in the network\'s advertiser list (deleted, or the list is still loading)' };
}

/**
 * EPC as the API computed it — payout ÷ GROSS clicks (invalid clicks included; reporting/postgres
 * `epc`), already rounded to 4 places server-side. Exported as that value, never re-rounded to 2.
 */
export function apiEpc(metrics: Record<string, string | number | undefined>): string {
  const v = metrics['epc'];
  if (v == null || v === '') return '0';
  return String(v);
}

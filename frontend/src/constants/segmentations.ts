/** Shared types/constants for Control Center › Segmentation Options — Categories, Channels, Labels,
 * Business Unit. Each is its own real network-scoped table now (previously Categories/Channels were
 * derived from Offer.category/Publisher.trafficSource free text with no backing catalog). */
export interface OfferCategory { id: string; ref: number; name: string; status: 'active' | 'inactive'; createdAt: string; updatedAt: string }
export interface PartnerChannel { id: string; ref: number; name: string; status: 'active' | 'inactive'; offerCount: number; createdAt: string; updatedAt: string }
export interface BusinessUnit { id: string; ref: number; name: string; createdAt: string; updatedAt: string }

export const LABEL_ENTITY_TYPES = ['offer', 'advertiser', 'publisher', 'smart_link', 'offer_group', 'partner_tier'] as const;
export type LabelEntityType = (typeof LABEL_ENTITY_TYPES)[number];

export interface LabelTag {
  id: string; name: string; color: string | null; createdAt: string;
  counts: Record<LabelEntityType, number>;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}

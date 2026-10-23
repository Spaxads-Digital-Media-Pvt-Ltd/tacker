/** Shared types/constants for Offers › Creatives, matching the reference's real "Manage Creatives"
 * (/offers/creatives): a network-wide catalog where one creative can target several offers at once
 * (stored as one row per offer), across seven asset types. */
import { api } from '../lib/api';

export interface Creative {
  id: string; ref: number; offerId: string; offerName?: string; offerRef?: number;
  name: string; type: CreativeType; url: string | null; html: string | null;
  /** A file from before object storage (F-27), still inline: lists leave `url` null; GET /api/creatives/:id has it. */
  urlInline?: boolean;
  width: number | null; height: number | null; language: string | null;
  status: 'active' | 'paused' | 'deleted';
  visibleToPartners: boolean; emailFrom: string | null; emailSubject: string | null;
  createdAt: string; updatedAt: string;
}

export type CreativeType = 'image' | 'html' | 'link' | 'email' | 'video' | 'archive' | 'thumbnail' | 'text';

export const TYPE_LABEL: Record<CreativeType, string> = {
  image: 'Image', html: 'HTML', link: 'Link', email: 'Email', video: 'Video', archive: 'Archive', thumbnail: 'Thumbnail', text: 'Text',
};

/** "+ Creative" dropdown items — matches the reference exactly. `emailOrHtml` is a single menu
 * entry that internally toggles between the `email` and `html` backend type values. */
export type MenuKey = 'archive' | 'emailOrHtml' | 'image' | 'link' | 'text' | 'thumbnail' | 'video';
export const ADD_MENU: { key: MenuKey; label: string; desc: string }[] = [
  { key: 'archive', label: 'Archive', desc: 'Add a folder of your creatives by uploading a Zip file' },
  { key: 'emailOrHtml', label: 'Email or HTML', desc: 'Add your HTML by uploading a Zip file or entering it manually' },
  { key: 'image', label: 'Image', desc: 'Add your image file' },
  { key: 'link', label: 'Link', desc: 'Add your creative link' },
  { key: 'text', label: 'Text', desc: 'Add your text file' },
  { key: 'thumbnail', label: 'Thumbnail', desc: 'Add your thumbnail file' },
  { key: 'video', label: 'Video', desc: 'Add your video file' },
];

export const FILE_ACCEPT: Partial<Record<MenuKey, string>> = {
  archive: '.zip', image: 'image/*', text: '.txt', thumbnail: 'image/*', video: 'video/*',
};

/** Maps a stored `type` (from an existing row, for Edit) back to the menu key that built it. */
export function typeToMenuKey(type: CreativeType): MenuKey {
  if (type === 'email' || type === 'html') return 'emailOrHtml';
  return type as MenuKey;
}

export const MACROS = [
  { token: '{click_id}', label: 'Click ID' },
  { token: '{offer_id}', label: 'Offer ID' },
  { token: '{publisher_id}', label: 'Partner ID' },
  { token: '{country}', label: 'Country' },
  { token: '{device}', label: 'Device' },
  { token: '{sub1}', label: 'Sub 1' },
  { token: '{sub2}', label: 'Sub 2' },
  { token: '{sub3}', label: 'Sub 3' },
  { token: '{sub4}', label: 'Sub 4' },
  { token: '{sub5}', label: 'Sub 5' },
];

/**
 * Macros the partner (outbound) postback actually fills — exactly the set the postback worker sends
 * (api-backend workers/processors/outbound-postback.ts). No {country} / {device}: those are filled on
 * offer destination URLs, never on a partner postback. `MACROS` above stays the creatives' list.
 */
export const POSTBACK_MACROS = [
  { token: '{click_id}', label: 'Click ID' },
  { token: '{conversion_id}', label: 'Conversion ID' },
  { token: '{offer_id}', label: 'Offer ID' },
  { token: '{publisher_id}', label: 'Partner ID' },
  { token: '{event}', label: 'Event' },
  { token: '{payout}', label: 'Payout' },
  { token: '{currency}', label: 'Currency' },
  { token: '{txn_id}', label: 'Transaction ID' },
  { token: '{sub1}', label: 'Sub 1' },
  { token: '{sub2}', label: 'Sub 2' },
  { token: '{sub3}', label: 'Sub 3' },
  { token: '{sub4}', label: 'Sub 4' },
  { token: '{sub5}', label: 'Sub 5' },
];

/** Upload size cap (the backend's too). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', zip: 'application/zip', txt: 'text/plain',
};

/** A creative file goes to object storage (F-27): POST /api/creatives/upload → the URL the creative keeps. */
export async function uploadCreativeFile(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`);
  }
  // Some systems give no type for .zip / .mov — fall back to the extension.
  const type = file.type || TYPE_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
  const res = await api.upload<{ url: string }>('/api/creatives/upload', type === file.type ? file : new Blob([file], { type }));
  return res.url;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}

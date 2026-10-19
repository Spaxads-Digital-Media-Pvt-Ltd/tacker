/**
 * Offer creative files (audit F-27). An uploaded creative lives in object storage (Supabase Storage,
 * public bucket `offer-creatives`, like offer thumbnails); its offer_creatives row keeps only the URL.
 * Before this, files were stored as base64 `data:` URIs in offer_creatives.url (up to ~6 MB each) and
 * every list returned them. Rows from then are moved by the backfill (lib/creatives/backfill.ts,
 * `npm run creatives:backfill`); until they are, lists show `url: null, urlInline: true` and only the
 * per-item detail serves the inline file.
 */
import { createHash, randomUUID } from 'node:crypto';
import { uploadPublicObject } from '../storage/supabase-storage.js';

export const CREATIVE_BUCKET = 'offer-creatives';
/** New uploads (the SPA's limit too). */
export const CREATIVE_MAX_BYTES = 2 * 1024 * 1024;
/** The bucket's own per-file limit — room for inline files the old 6M-character field allowed. */
const BUCKET_MAX_BYTES = 5 * 1024 * 1024;

/** What a creative file may be. No SVG: it can carry script, and the bucket serves files publicly. */
export const CREATIVE_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'text/plain': 'txt',
};
export const CREATIVE_TYPES_TEXT = 'PNG, JPEG, WebP, GIF, MP4, WebM, MOV, ZIP or TXT';

export const isInlineData = (url: unknown): boolean => typeof url === 'string' && /^data:/i.test(url);

/**
 * The url columns for a list query over offer_creatives (`alias`): an inline file comes back as
 * `url: null` + `url_inline: true` — never its bytes (`left()` reads only the start of the value).
 */
export const listUrlColumns = (alias: string): string =>
  `CASE WHEN left(${alias}.url, 5) ILIKE 'data:' THEN NULL ELSE ${alias}.url END AS url, `
  + `COALESCE(left(${alias}.url, 5) ILIKE 'data:', false) AS url_inline`;

/** Upload a creative file for a network; returns its public URL. */
export async function uploadCreativeFile(networkId: string, bytes: Buffer, contentType: string, name: string = randomUUID()): Promise<string> {
  const ext = CREATIVE_UPLOAD_TYPES[contentType];
  if (!ext) throw new Error(`Unsupported file type (${contentType || 'unknown'}) — upload ${CREATIVE_TYPES_TEXT}`);
  return uploadPublicObject(CREATIVE_BUCKET, `${networkId}/${name}.${ext}`, bytes, contentType, { bucketMaxBytes: BUCKET_MAX_BYTES });
}

/** A `data:` URI → its media type and bytes (null when it isn't one). */
export function parseDataUri(uri: string): { contentType: string; bytes: Buffer } | null {
  const m = /^data:([^,]*?),(.*)$/is.exec(uri);
  if (!m) return null;
  const meta = m[1]!.split(';').map((s) => s.trim());
  const base64 = meta.slice(1).some((p) => p.toLowerCase() === 'base64');
  const contentType = (meta[0] || 'text/plain').toLowerCase();
  try {
    return { contentType, bytes: base64 ? Buffer.from(m[2]!, 'base64') : Buffer.from(decodeURIComponent(m[2]!), 'utf8') };
  } catch {
    return null;
  }
}

/** A content address for a file — the same bytes always map to the same object (backfill re-runs). */
export const contentName = (bytes: Buffer): string => `sha256-${createHash('sha256').update(bytes).digest('hex').slice(0, 40)}`;

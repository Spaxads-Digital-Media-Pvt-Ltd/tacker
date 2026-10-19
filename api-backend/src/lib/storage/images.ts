/**
 * Small images people upload — Control Center branding (logo, favicon) and profile photos (O12). The
 * file goes to object storage (public bucket `network-images`, content-addressed per network + kind)
 * and the settings / user row keep only its URL. Before this they were data: URIs inside
 * networks.settings and users.metadata (up to ~6 MB each, read with every settings load); rows from
 * then are moved by `npm run images:backfill` (lib/storage/images-backfill.ts).
 * No SVG (D5): it can carry script, and the bucket serves files publicly.
 */
import { z } from 'zod';
import { uploadPublicObject } from './supabase-storage.js';
import { contentName, isInlineData } from '../creatives/files.js';
import { validationFailed } from '../http/errors.js';

export const IMAGE_BUCKET = 'network-images';
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export type ImageKind = 'logo' | 'favicon' | 'photo';
const IMAGE_TYPES: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const ICON_TYPES: Readonly<Record<string, string>> = { ...IMAGE_TYPES, 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };

/** What each kind may be: a favicon may also be an .ico. */
export const imageTypesFor = (kind: ImageKind): Readonly<Record<string, string>> => (kind === 'favicon' ? ICON_TYPES : IMAGE_TYPES);
export const imageTypesText = (kind: ImageKind): string => (kind === 'favicon' ? 'PNG, JPEG, WebP, GIF or ICO' : 'PNG, JPEG, WebP or GIF');
/** Every type an upload route reads as a raw body (each route then checks its kind). */
export const IMAGE_UPLOAD_CONTENT_TYPES = Object.keys(ICON_TYPES);

/** Store an image; returns its public URL. Same bytes → same object (re-uploads and the backfill reuse it). */
export async function uploadImage(networkId: string, kind: ImageKind, bytes: Buffer, contentType: string): Promise<string> {
  const ext = imageTypesFor(kind)[contentType];
  if (!ext) throw new Error(`Upload a ${imageTypesText(kind)} image up to 2 MB`);
  return uploadPublicObject(IMAGE_BUCKET, `${networkId}/${kind}/${contentName(bytes)}.${ext}`, bytes, contentType, { bucketMaxBytes: IMAGE_MAX_BYTES });
}

/** An image as settings / user rows keep it: the URL of the stored file — never the file itself. */
export const imageUrlSchema = z.string().trim().max(2000)
  .refine((u) => /^https?:\/\/\S+$/i.test(u), { message: 'must be the URL of an uploaded image (upload the file first) — a data: URI is not stored' });

/**
 * Check a submitted image value: null, or an uploaded image's URL. A data: URI passes only when it is
 * the value already stored (an untouched legacy image the backfill hasn't moved yet) — a new one is a 422.
 */
export function assertImageValue(next: unknown, stored: unknown, field: string): void {
  if (next == null) return;
  if (isInlineData(next) && next === stored) return;
  const r = imageUrlSchema.safeParse(next);
  if (!r.success) throw validationFailed(`${field} ${r.error.issues[0]?.message ?? 'is not a valid image URL'}`);
}

/** The upload's media type from its Content-Type header. */
export const uploadContentType = (header: unknown): string => String(header ?? '').split(';')[0]!.trim().toLowerCase();

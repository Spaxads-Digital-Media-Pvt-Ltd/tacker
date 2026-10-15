/**
 * Small images people upload — Control Center logo / favicon and profile photos (O12). The file goes
 * to object storage through the API (POST …/branding/:kind, POST /api/me/photo) and the page keeps
 * only the URL it gets back; nothing is read into a data: URI any more. PNG, JPEG, WebP or GIF (a
 * favicon may also be ICO), up to 2 MB — no SVG (it can carry script; the API refuses it too).
 */
import { api } from './api';

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon',
};
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ICON_TYPES = [...IMAGE_TYPES, 'image/x-icon', 'image/vnd.microsoft.icon'];

/** The file input's `accept`. */
export const imageAccept = (allowIco = false): string =>
  [...(allowIco ? ICON_TYPES : IMAGE_TYPES), '.jfif', ...(allowIco ? ['.ico'] : [])].join(',');

/** What's accepted, for messages. */
export const imageTypesText = (allowIco = false): string => (allowIco ? 'PNG, JPEG, WebP, GIF or ICO' : 'PNG, JPEG, WebP or GIF');

/** The upload's media type (some systems give none for .ico / .jfif — the extension decides), or a reason it's refused. */
export function imageTypeOf(file: { type: string; name: string; size: number }, allowIco = false): { type: string } | { problem: string } {
  const type = (file.type || BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || '').toLowerCase();
  if (type === 'image/svg+xml') return { problem: "SVG images aren't accepted (they can carry script) — use a PNG instead." };
  if (!(allowIco ? ICON_TYPES : IMAGE_TYPES).includes(type)) return { problem: `Upload a ${imageTypesText(allowIco)} image.` };
  if (file.size > IMAGE_MAX_BYTES) return { problem: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB.` };
  return { type };
}

/** Upload an image to `path`; resolves to its stored URL, or throws with a message to show. */
export async function uploadImage(path: string, file: File, allowIco = false): Promise<string> {
  const t = imageTypeOf(file, allowIco);
  if ('problem' in t) throw new Error(t.problem);
  const res = await api.upload<{ url: string }>(path, t.type === file.type ? file : new Blob([file], { type: t.type }));
  return res.url;
}

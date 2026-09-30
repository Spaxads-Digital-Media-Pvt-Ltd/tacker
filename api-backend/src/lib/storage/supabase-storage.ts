/**
 * Minimal Supabase Storage client (REST, service-role, BACKEND ONLY — the browser never talks to
 * Supabase). Used for offer thumbnails. The bucket is created public on first upload if missing.
 */
import { env } from '../../config/env.js';

function config(): { url: string; key: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('File storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  return { url: env.SUPABASE_URL.replace(/\/+$/, ''), key: env.SUPABASE_SERVICE_ROLE_KEY };
}

const ensured = new Set<string>();

async function ensurePublicBucket(bucket: string): Promise<void> {
  if (ensured.has(bucket)) return;
  const { url, key } = config();
  const headers = { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' };
  const existing = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers });
  if (!existing.ok) {
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: 2 * 1024 * 1024 }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`Could not create storage bucket (HTTP ${res.status})`);
  }
  ensured.add(bucket);
}

/** Upload bytes and return the object's public URL. */
export async function uploadPublicObject(bucket: string, path: string, body: Buffer, contentType: string): Promise<string> {
  await ensurePublicBucket(bucket);
  const { url, key } = config();
  const objectPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': contentType, 'x-upsert': 'true' },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
  return `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
}

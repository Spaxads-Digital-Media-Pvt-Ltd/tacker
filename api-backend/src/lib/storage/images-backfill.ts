/**
 * Backfill (O12): move images stored inline — data: URIs in a network's Control Center branding
 * (settings.controlCenter.platform.branding.logoUrl / faviconUrl) and in team members' profile photos
 * (users.metadata.photoUrl) — into object storage, replacing each with the stored file's URL. Each value
 * is replaced only if it is still the same data: URI (a concurrent edit wins). A file storage won't take
 * (an SVG, an unknown type, a failed upload) stays inline and is reported. Idempotent — content-addressed
 * uploads; run it again any time (`npm run images:backfill`).
 */
import { query } from '../db/pool.js';
import { writeSystemAudit } from '../audit.js';
import { isInlineData, parseDataUri } from '../creatives/files.js';
import { imageTypesFor, imageTypesText, uploadImage, type ImageKind } from './images.js';

export interface ImageBackfillResult {
  /** Images moved to storage (or, dry run, that would be). */
  moved: number;
  /** Left inline, with why. */
  skipped: { networkId: string; where: string; reason: string }[];
}

/** Why an inline image can't be stored, or null. */
function refusal(kind: ImageKind, uri: string): { reason: string } | { file: { contentType: string; bytes: Buffer } } {
  const file = parseDataUri(uri);
  if (!file) return { reason: 'not a readable data: URI' };
  if (!imageTypesFor(kind)[file.contentType]) return { reason: `${file.contentType} isn't stored (${imageTypesText(kind)} only) — upload it again in one of those` };
  if (file.bytes.length === 0) return { reason: 'empty file' };
  return { file };
}

export async function backfillInlineImages(opts: { dryRun?: boolean } = {}): Promise<ImageBackfillResult> {
  const out: ImageBackfillResult = { moved: 0, skipped: [] };

  // Control Center branding.
  const { rows: networks } = await query<{ id: string; branding: Record<string, unknown> | null }>(
    `SELECT id, settings->'controlCenter'->'platform'->'branding' AS branding FROM networks ORDER BY created_at`);
  for (const n of networks) {
    for (const [field, kind] of [['logoUrl', 'logo'], ['faviconUrl', 'favicon']] as const) {
      const uri = n.branding?.[field];
      if (!isInlineData(uri)) continue;
      const where = `branding.${field}`;
      const r = refusal(kind, uri as string);
      if ('reason' in r) { out.skipped.push({ networkId: n.id, where, reason: r.reason }); continue; }
      if (opts.dryRun) { out.moved++; continue; }
      let url: string;
      try { url = await uploadImage(n.id, kind, r.file.bytes, r.file.contentType); } catch (err) {
        out.skipped.push({ networkId: n.id, where, reason: err instanceof Error ? err.message : 'upload failed' });
        continue;
      }
      const { rowCount } = await query(
        `UPDATE networks SET settings = jsonb_set(settings, ARRAY['controlCenter', 'platform', 'branding', $2::text], to_jsonb($3::text))
          WHERE id = $1 AND settings->'controlCenter'->'platform'->'branding'->>$2 = $4`,
        [n.id, field, url, uri]);
      if (!rowCount) continue; // changed meanwhile
      await writeSystemAudit(n.id, {
        action: 'control_center.branding.backfill', entityType: 'network', entityId: n.id,
        before: { [field]: { inline: true, contentType: r.file.contentType, bytes: r.file.bytes.length } }, after: { [field]: url },
      });
      out.moved++;
    }
  }

  // Team members' profile photos.
  const { rows: users } = await query<{ id: string; network_id: string; photo: string }>(
    `SELECT id, network_id, metadata->>'photoUrl' AS photo FROM users WHERE left(metadata->>'photoUrl', 5) ILIKE 'data:' ORDER BY created_at`);
  for (const u of users) {
    const where = `users.${u.id}.photoUrl`;
    const r = refusal('photo', u.photo);
    if ('reason' in r) { out.skipped.push({ networkId: u.network_id, where, reason: r.reason }); continue; }
    if (opts.dryRun) { out.moved++; continue; }
    let url: string;
    try { url = await uploadImage(u.network_id, 'photo', r.file.bytes, r.file.contentType); } catch (err) {
      out.skipped.push({ networkId: u.network_id, where, reason: err instanceof Error ? err.message : 'upload failed' });
      continue;
    }
    const { rowCount } = await query(
      `UPDATE users SET metadata = jsonb_set(metadata, '{photoUrl}', to_jsonb($3::text))
        WHERE network_id = $1 AND id = $2 AND metadata->>'photoUrl' = $4`,
      [u.network_id, u.id, url, u.photo]);
    if (!rowCount) continue;
    await writeSystemAudit(u.network_id, {
      action: 'user.photo.backfill', entityType: 'users', entityId: u.id,
      before: { photoUrl: { inline: true, contentType: r.file.contentType, bytes: r.file.bytes.length } }, after: { photoUrl: url },
    });
    out.moved++;
  }
  return out;
}

/**
 * Backfill (audit F-27): move creatives stored before object storage — the file inline as a data: URI
 * in offer_creatives.url — into storage, replacing the inline data with the URL. Network by network,
 * each distinct file is uploaded once under a content address (so a fanned-out creative's sibling rows
 * and a re-run reuse the same object), then every row of that network holding exactly that data gets
 * the URL. A file storage won't take (an SVG, an unknown type, a failed upload) stays inline and is
 * reported. Idempotent: run it again any time (`npm run creatives:backfill`).
 */
import { query } from '../db/pool.js';
import { writeSystemAudit } from '../audit.js';
import { CREATIVE_TYPES_TEXT, CREATIVE_UPLOAD_TYPES, contentName, isInlineData, parseDataUri, uploadCreativeFile } from './files.js';

export interface BackfillResult {
  /** Distinct files uploaded (or, dry run, that would be). */
  files: number;
  /** Creative rows now pointing at storage (or that would). */
  rows: number;
  /** Left inline, with why. */
  skipped: { networkId: string; ids: string[]; reason: string }[];
}

export async function backfillInlineCreatives(opts: { dryRun?: boolean; batch?: number } = {}): Promise<BackfillResult> {
  const out: BackfillResult = { files: 0, rows: 0, skipped: [] };
  const { rows: networks } = await query<{ id: string }>('SELECT id FROM networks ORDER BY created_at');
  for (const { id: networkId } of networks) {
    const seen: string[] = []; // md5s handled this run (moved or skipped), so the loop never revisits one
    for (;;) {
      const { rows: groups } = await query<{ h: string; ids: string[] }>(
        `SELECT md5(url) AS h, array_agg(id::text ORDER BY id) AS ids FROM offer_creatives
          WHERE network_id = $1 AND left(url, 5) ILIKE 'data:' AND NOT (md5(url) = ANY($2::text[]))
          GROUP BY md5(url) LIMIT $3`, [networkId, seen, opts.batch ?? 50]);
      if (!groups.length) break;
      for (const g of groups) {
        seen.push(g.h);
        const inline = (await query<{ url: string | null }>(
          'SELECT url FROM offer_creatives WHERE network_id = $1 AND id = $2', [networkId, g.ids[0]])).rows[0]?.url;
        if (!isInlineData(inline)) continue; // changed meanwhile
        const file = parseDataUri(inline!);
        const reason = !file ? 'not a readable data: URI'
          : !CREATIVE_UPLOAD_TYPES[file.contentType] ? `${file.contentType} files aren't stored (${CREATIVE_TYPES_TEXT} only) — re-upload it in a stored type`
            : file.bytes.length === 0 ? 'empty file' : null;
        if (reason || !file) { out.skipped.push({ networkId, ids: g.ids, reason: reason ?? 'unreadable' }); continue; }
        if (opts.dryRun) { out.files++; out.rows += g.ids.length; continue; }

        let url: string;
        try {
          url = await uploadCreativeFile(networkId, file.bytes, file.contentType, contentName(file.bytes));
        } catch (err) {
          out.skipped.push({ networkId, ids: g.ids, reason: err instanceof Error ? err.message : 'upload failed' });
          continue;
        }
        const { rows: moved } = await query<{ id: string }>(
          `UPDATE offer_creatives SET url = $3 WHERE network_id = $1 AND md5(url) = $2 AND url = $4 RETURNING id`,
          [networkId, g.h, url, inline]);
        for (const m of moved) {
          await writeSystemAudit(networkId, {
            action: 'offer.creative.backfill', entityType: 'offer_creatives', entityId: m.id,
            before: { inline: true, contentType: file.contentType, bytes: file.bytes.length }, after: { url },
          });
        }
        out.files++;
        out.rows += moved.length;
      }
    }
  }
  return out;
}

/**
 * One-off (audit F-27): move creatives stored inline — the file as a data: URI in
 * offer_creatives.url, from before creatives went to object storage — into storage
 * (lib/creatives/backfill.ts).
 *
 *   npm run creatives:backfill -- --dry-run   # report what would move
 *   npm run creatives:backfill                # upload + replace (idempotent; re-run any time)
 *
 * Needs Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Until it runs, the API keeps
 * those files out of every list (url null, urlInline true) and serves them from GET /api/creatives/:id.
 */
import { closeDb } from '../src/lib/db/pool.js';
import { env } from '../src/config/env.js';
import { backfillInlineCreatives } from '../src/lib/creatives/backfill.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('File storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — nothing moved');
  }
  const r = await backfillInlineCreatives({ dryRun });
  for (const s of r.skipped) logger.warn({ networkId: s.networkId, creatives: s.ids, reason: s.reason }, 'creative left inline');
  logger.info({ files: r.files, rows: r.rows, skipped: r.skipped.length, dryRun }, 'creatives backfill done');
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'creatives backfill failed');
  void closeDb().finally(() => process.exit(1));
});

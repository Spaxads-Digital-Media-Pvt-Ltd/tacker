/**
 * One-off (O12): move images stored inline — data: URIs in Control Center branding (logo, favicon)
 * and team members' profile photos, from before they went to object storage — into storage
 * (lib/storage/images-backfill.ts).
 *
 *   npm run images:backfill -- --dry-run   # report what would move
 *   npm run images:backfill                # upload + replace (idempotent; re-run any time)
 *
 * Needs Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */
import { closeDb } from '../src/lib/db/pool.js';
import { env } from '../src/config/env.js';
import { backfillInlineImages } from '../src/lib/storage/images-backfill.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('File storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — nothing moved');
  }
  const r = await backfillInlineImages({ dryRun });
  for (const s of r.skipped) logger.warn({ networkId: s.networkId, where: s.where, reason: s.reason }, 'image left inline');
  logger.info({ moved: r.moved, skipped: r.skipped.length, dryRun }, 'images backfill done');
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'images backfill failed');
  void closeDb().finally(() => process.exit(1));
});

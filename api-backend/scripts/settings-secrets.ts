/**
 * One-off (audit F-07): encrypt the secrets already stored in networks.settings — integration
 * credentials + SMTP password — with SETTINGS_ENC_KEY, or decrypt them back to plaintext.
 *
 *   npm run settings:secrets -- encrypt --dry-run   # report what would change
 *   npm run settings:secrets -- encrypt             # encrypt plaintext values (idempotent)
 *   npm run settings:secrets -- decrypt             # undo: back to plaintext (e.g. before a key rotation)
 *
 * The app reads both forms, so this can run any time after the encryption release is deployed.
 * Each network is rewritten in its own transaction with the row locked. Never prints a secret.
 */
import { pool, closeDb } from '../src/lib/db/pool.js';
import { rewriteSettingsSecrets, type SecretsMode } from '../src/lib/crypto/settings-secrets.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  const mode = process.argv[2] as SecretsMode;
  const dryRun = process.argv.includes('--dry-run');
  if (mode !== 'encrypt' && mode !== 'decrypt') throw new Error('usage: settings-secrets.ts encrypt|decrypt [--dry-run]');

  const { rows: ids } = await pool.query<{ id: string }>('SELECT id FROM networks ORDER BY created_at');
  let total = 0;
  for (const { id } of ids) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ settings: Record<string, unknown> }>(
        'SELECT settings FROM networks WHERE id = $1 FOR UPDATE', [id]);
      const { settings, changed } = rewriteSettingsSecrets(rows[0]?.settings ?? {}, mode);
      if (changed.length && !dryRun) {
        await client.query('UPDATE networks SET settings = $2 WHERE id = $1', [id, JSON.stringify(settings)]);
      }
      await client.query('COMMIT');
      if (changed.length) logger.info({ networkId: id, fields: changed, dryRun }, `settings secrets: ${mode}`);
      total += changed.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info({ networks: ids.length, fields: total, dryRun }, `settings secrets: ${mode} done`);
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'settings secrets failed');
  void closeDb().finally(() => process.exit(1));
});

/**
 * Two-factor sign-in for the platform team (Super Admin): checking a code, recovery codes, and the platform's
 * security setting (platform_settings 'security' { requireTwoFactor } — cached 10 s per process).
 *
 * A code's step is recorded atomically (only if newer than the last one used), so a code can't be replayed —
 * not even by two requests at once. A recovery code is removed as it's used.
 */
import { query } from '../db/pool.js';
import { decryptSecret } from '../crypto/secret-box.js';
import { hashRecoveryCode, looksLikeRecoveryCode, verifyTotp } from '../auth/totp.js';

export interface SecuritySettings { requireTwoFactor: boolean }
let cache: { at: number; value: SecuritySettings } | null = null;

export async function securitySettings(): Promise<SecuritySettings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const v = (await query<{ value: Partial<SecuritySettings> }>(`SELECT value FROM platform_settings WHERE key = 'security'`)).rows[0]?.value ?? {};
  const value = { requireTwoFactor: v.requireTwoFactor === true };
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSecuritySettings(value: SecuritySettings, by: string | null): Promise<SecuritySettings> {
  await query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('security', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(value), by]);
  cache = null;
  return securitySettings();
}

/**
 * The member's second factor: a current authenticator code (not used before) or one of their recovery codes
 * (then spent). 'totp' / 'recovery', or null when it doesn't match.
 */
export async function checkSecondFactor(adminId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const row = (await query<{ totp_secret: string | null; totp_last_step: string | null }>(
    'SELECT totp_secret, totp_last_step::text FROM platform_admins WHERE id = $1 AND totp_enabled_at IS NOT NULL', [adminId])).rows[0];
  if (!row?.totp_secret) return null;
  if (looksLikeRecoveryCode(code)) {
    const used = await query(
      `UPDATE platform_admins SET recovery_code_hashes = array_remove(recovery_code_hashes, $2)
        WHERE id = $1 AND $2 = ANY(recovery_code_hashes) RETURNING id`, [adminId, hashRecoveryCode(code)]);
    return used.rowCount ? 'recovery' : null;
  }
  let secret: string;
  try { secret = decryptSecret(row.totp_secret); } catch { return null; }
  const step = verifyTotp(secret, code, Date.now(), row.totp_last_step === null ? null : Number(row.totp_last_step));
  if (step === null) return null;
  const claimed = await query(
    `UPDATE platform_admins SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id`, [adminId, step]);
  return claimed.rowCount ? 'totp' : null;
}

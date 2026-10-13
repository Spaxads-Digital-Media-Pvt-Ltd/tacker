/**
 * Every secret inside one networks.settings object — the integration credentials and the SMTP
 * password (audit F-07) — encrypted, or decrypted back to plaintext. Pure; used by the one-off
 * scripts/settings-secrets.ts to encrypt values written before encryption at rest existed (and to
 * undo it). Values already in the target form are left alone, so it is safe to re-run.
 */
import { encryptSecret, decryptSecret, isEncrypted } from './secret-box.js';
import { isSecretIntegrationKey } from '../integrations/settings.js';

export type SecretsMode = 'encrypt' | 'decrypt';

function rewrite(value: unknown, mode: SecretsMode): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (mode === 'encrypt') return isEncrypted(value) ? null : encryptSecret(value);
  return isEncrypted(value) ? decryptSecret(value) : null;
}

export function rewriteSettingsSecrets(
  settings: Record<string, unknown>, mode: SecretsMode,
): { settings: Record<string, unknown>; changed: string[] } {
  const changed: string[] = [];
  const out: Record<string, unknown> = { ...settings };

  const integrations = settings['integrations'];
  if (integrations && typeof integrations === 'object' && !Array.isArray(integrations)) {
    const next: Record<string, unknown> = { ...(integrations as Record<string, unknown>) };
    for (const [k, v] of Object.entries(next)) {
      if (!isSecretIntegrationKey(k)) continue;
      const r = rewrite(v, mode);
      if (r !== null) { next[k] = r; changed.push(`integrations.${k}`); }
    }
    out['integrations'] = next;
  }

  const smtp = settings['smtp'];
  if (smtp && typeof smtp === 'object' && !Array.isArray(smtp)) {
    const r = rewrite((smtp as Record<string, unknown>)['password'], mode);
    if (r !== null) { out['smtp'] = { ...(smtp as Record<string, unknown>), password: r }; changed.push('smtp.password'); }
  }

  return { settings: out, changed };
}

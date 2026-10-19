/**
 * Encryption at rest for secrets kept in networks.settings — integration credentials and the SMTP
 * password (audit F-07). AES-256-GCM with SETTINGS_ENC_KEY and a random 96-bit IV per value; the
 * auth tag makes tampering (or a wrong key) fail loudly instead of decrypting to garbage.
 *
 * Stored form: `enc:v1:<iv>:<tag>:<ciphertext>` (base64url). A value without that prefix is legacy
 * plaintext written before encryption existed: it is returned as-is, so integrations keep working
 * until scripts/settings-secrets.ts encrypts it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env, settingsKeyBytes } from '../../config/env.js';

const PREFIX = 'enc:v1:';

let key: Buffer | null = null;
function encKey(): Buffer {
  if (!key) {
    const k = settingsKeyBytes(env.SETTINGS_ENC_KEY);
    if (!k) throw new Error('SETTINGS_ENC_KEY must be 32 bytes: 64 hex chars or base64');
    key = k;
  }
  return key;
}

export const isEncrypted = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PREFIX);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${data.toString('base64url')}`;
}

/** The plaintext of a stored secret (legacy plaintext passes through). Throws on a wrong key or tampering. */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
  if (!iv || !tag || data === undefined) throw new Error('Stored secret is malformed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored secret could not be decrypted — was SETTINGS_ENC_KEY changed?');
  }
}

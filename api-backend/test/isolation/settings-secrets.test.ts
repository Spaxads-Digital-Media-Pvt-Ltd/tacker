/**
 * Settings secrets at rest (audit F-07) — pure helpers, no DB: the AES-256-GCM secret box, the
 * SETTINGS_ENC_KEY format check, which integration keys count as credentials, masking for the
 * browser, keep-if-empty merging, and the one-off rewrite (encrypt / decrypt back).
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, isEncrypted } from '../../src/lib/crypto/secret-box.js';
import { settingsKeyBytes } from '../../src/config/env.js';
import {
  isSecretIntegrationKey, maskIntegrations, mergeIntegrationsPatch, secretValue,
} from '../../src/lib/integrations/settings.js';
import { rewriteSettingsSecrets } from '../../src/lib/crypto/settings-secrets.js';

describe('secret box (AES-256-GCM)', () => {
  it('round-trips, with a fresh IV every time and no plaintext in the stored form', () => {
    const a = encryptSecret('ipqs-key-123');
    const b = encryptSecret('ipqs-key-123');
    expect(a).toMatch(/^enc:v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('ipqs-key-123');
    expect(decryptSecret(a)).toBe('ipqs-key-123');
    expect(decryptSecret(encryptSecret(''))).toBe('');
    expect(decryptSecret(encryptSecret('ünïcødé ✓'))).toBe('ünïcødé ✓');
  });

  it('legacy plaintext (written before encryption) passes through', () => {
    expect(isEncrypted('plain-old-key')).toBe(false);
    expect(decryptSecret('plain-old-key')).toBe('plain-old-key');
  });

  it('a tampered value or a wrong key fails loudly instead of decrypting to garbage', () => {
    const [p0, p1, iv, tag, data] = encryptSecret('secret').split(':') as [string, string, string, string, string];
    const flippedData = (data[0] === 'A' ? 'B' : 'A') + data.slice(1); // first ciphertext byte changed
    expect(() => decryptSecret([p0, p1, iv, tag, flippedData].join(':'))).toThrow(/could not be decrypted/);
    const otherTag = randomBytes(16).toString('base64url'); // what a different key would produce
    expect(() => decryptSecret([p0, p1, iv, otherTag, data].join(':'))).toThrow(/could not be decrypted/);
    expect(() => decryptSecret('enc:v1:only-one-part')).toThrow(/malformed/);
  });

  it('SETTINGS_ENC_KEY must be 32 bytes as hex or base64', () => {
    const k = randomBytes(32);
    expect(settingsKeyBytes(k.toString('hex'))?.equals(k)).toBe(true);
    expect(settingsKeyBytes(k.toString('base64'))?.equals(k)).toBe(true);
    expect(settingsKeyBytes(k.toString('base64url'))?.equals(k)).toBe(true);
    expect(settingsKeyBytes(randomBytes(16).toString('hex'))).toBeNull();
    expect(settingsKeyBytes(randomBytes(31).toString('base64'))).toBeNull();
    expect(settingsKeyBytes('not-a-key')).toBeNull();
    expect(settingsKeyBytes('')).toBeNull();
  });
});

describe('integration credentials', () => {
  it('every key/token/secret/password field is a credential; ids, urls and flags are not', () => {
    for (const k of ['ipQualityScoreApiKey', 'fbAccessToken', 'offerFeedKey', 'pinApiKey', 'shopifyApiKey', 'stripeApiKey', 'appsflyerApiKey', 'clientSecret', 'smtpPassword']) {
      expect(isSecretIntegrationKey(k)).toBe(true);
    }
    for (const k of ['fbPixelId', 'offerFeedUrl', 'offerFeedName', 'offerFeedAdvertiserId', 'woocommerceStoreUrl', 'shopifyApiEnabled', 'esignAgreementUrl', 'offerFeedLastSyncError']) {
      expect(isSecretIntegrationKey(k)).toBe(false);
    }
  });

  it('masking replaces every credential with <key>Set and keeps everything else', () => {
    expect(maskIntegrations({ ipQualityScoreApiKey: encryptSecret('x'), fbAccessToken: '', fbPixelId: '123', offerFeedUrl: 'https://f.example/x' }))
      .toEqual({ ipQualityScoreApiKeySet: true, fbAccessTokenSet: false, fbPixelId: '123', offerFeedUrl: 'https://f.example/x' });
  });

  it("merging: a non-empty credential is encrypted; '' keeps the stored one; null removes it", () => {
    const stored = encryptSecret('old-key');
    const merged = mergeIntegrationsPatch({ ipQualityScoreApiKey: stored, fbAccessToken: encryptSecret('tok'), fbPixelId: '1' },
      { ipQualityScoreApiKey: '', fbAccessToken: null, pinApiKey: 'pin-123', fbPixelId: '2' });
    expect(merged['ipQualityScoreApiKey']).toBe(stored);
    expect('fbAccessToken' in merged).toBe(false);
    expect(isEncrypted(merged['pinApiKey'])).toBe(true);
    expect(decryptSecret(merged['pinApiKey'] as string)).toBe('pin-123');
    expect(merged['fbPixelId']).toBe('2');
  });

  it('secretValue decrypts at the point of use (and reads legacy plaintext)', () => {
    expect(secretValue({ k: encryptSecret('real-key') }, 'k')).toBe('real-key');
    expect(secretValue({ k: 'legacy-plain' }, 'k')).toBe('legacy-plain');
    expect(secretValue({ k: '' }, 'k')).toBeNull();
    expect(secretValue({}, 'k')).toBeNull();
  });
});

describe('one-off rewrite of stored settings', () => {
  const legacy = {
    general: { timezone: 'UTC' },
    smtp: { host: 'smtp.example.com', password: 'smtp-pass' },
    integrations: { ipQualityScoreApiKey: 'ipqs-plain', fbPixelId: '42', offerFeedKey: '', fbAccessToken: encryptSecret('already') },
  };

  it('encrypt: only plaintext credentials + the SMTP password change; re-running is a no-op', () => {
    const { settings, changed } = rewriteSettingsSecrets(legacy, 'encrypt');
    expect(changed.sort()).toEqual(['integrations.ipQualityScoreApiKey', 'smtp.password']);
    const i = settings['integrations'] as Record<string, unknown>;
    const smtp = settings['smtp'] as Record<string, unknown>;
    expect(decryptSecret(i['ipQualityScoreApiKey'] as string)).toBe('ipqs-plain');
    expect(decryptSecret(smtp['password'] as string)).toBe('smtp-pass');
    expect(i['fbAccessToken']).toBe(legacy.integrations.fbAccessToken);
    expect(i['fbPixelId']).toBe('42');
    expect(settings['general']).toEqual({ timezone: 'UTC' });
    expect(rewriteSettingsSecrets(settings, 'encrypt').changed).toEqual([]);
  });

  it('decrypt undoes it', () => {
    const { settings } = rewriteSettingsSecrets(rewriteSettingsSecrets(legacy, 'encrypt').settings, 'decrypt');
    expect((settings['integrations'] as Record<string, unknown>)['ipQualityScoreApiKey']).toBe('ipqs-plain');
    expect((settings['integrations'] as Record<string, unknown>)['fbAccessToken']).toBe('already');
    expect((settings['smtp'] as Record<string, unknown>)['password']).toBe('smtp-pass');
  });
});

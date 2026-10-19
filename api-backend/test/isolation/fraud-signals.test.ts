/**
 * Click fraud pre-signals (audit F-23) — no DB; Redis is an in-memory stub.
 *
 * The score is built from the network's weights: datacenter IP, per-IP velocity over the network's
 * limit, a bot / headless / scripted (or missing) user agent, and — for offers with IPQualityScore
 * on — the IP's cached IPQS verdict for this network (proxy / VPN / Tor / bot flags, and at least
 * IPQS's own fraud_score). The fraud-rules view never shows the alert webhook's path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('../../src/lib/redis.js', () => ({
  getRedis: () => ({
    incr: async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
    expire: async () => 1,
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    del: async (k: string) => { store.delete(k); return 1; },
  }),
}));

import { fraudPreSignals, foldIpqsVerdict, isBotUserAgent } from '../../src/surfaces/tracking/fraud-presignals.js';
import { DEFAULT_FRAUD_CONFIG, fraudConfigView, fraudAlertChannels, type FraudConfig, type FraudConfigPatch } from '../../src/lib/fraud/rules.js';
import { ipqsCacheKey } from '../../src/lib/integrations/ipqs.js';
import { encryptSecret } from '../../src/lib/crypto/secret-box.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const NET = '00000000-0000-4000-8000-0000000000aa';
const OTHER_NET = '00000000-0000-4000-8000-0000000000bb';

const cfg = (p: FraudConfigPatch = {}): FraudConfig => ({
  ...DEFAULT_FRAUD_CONFIG, ...p, weights: { ...DEFAULT_FRAUD_CONFIG.weights, ...(p.weights ?? {}) },
});
const signals = (over: Partial<Parameters<typeof fraudPreSignals>[0]> = {}, c = cfg()) =>
  fraudPreSignals({ networkId: NET, ip: '198.51.100.7', isDatacenter: false, userAgent: CHROME, ipqs: false, ...over }, c);

beforeEach(() => store.clear());

describe('bot / headless / scripted user agents', () => {
  it.each([
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36',
    'curl/8.7.1', 'Wget/1.21.4', 'python-requests/2.32.3', 'Go-http-client/2.0', 'Java/17.0.2', 'node-fetch/1.0', 'axios/1.7.2',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'AdsBot-Google (+http://www.google.com/adsbot.html)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'Scrapy/2.11 (+https://scrapy.org)',
  ])('flags %s', (ua) => expect(isBotUserAgent(ua)).toBe(true));

  it.each([
    CHROME,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; CUBOT X30 Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  ])('does not flag a real browser: %s', (ua) => expect(isBotUserAgent(ua)).toBe(false));
});

describe('fraudPreSignals', () => {
  it('a real browser from an ordinary IP scores 0 with no flags', async () => {
    expect(await signals()).toEqual({ score: 0, flags: [] });
  });

  it('a scripted user agent, or none at all, adds the bot weight', async () => {
    expect(await signals({ userAgent: 'curl/8.7.1' })).toEqual({ score: 50, flags: ['bot_user_agent'] });
    expect(await signals({ userAgent: null })).toEqual({ score: 50, flags: ['no_user_agent'] });
    expect(await signals({ userAgent: '   ' })).toEqual({ score: 50, flags: ['no_user_agent'] });
  });

  it("signals add up with the network's own weights, capped at 100", async () => {
    expect(await signals({ isDatacenter: true, userAgent: 'curl/8.7.1' })).toEqual({ score: 90, flags: ['datacenter_ip', 'bot_user_agent'] });
    expect((await signals({ isDatacenter: true, userAgent: 'curl/8.7.1' }, cfg({ weights: { datacenter: 70 } }))).score).toBe(100);
    expect((await signals({ isDatacenter: true }, cfg({ weights: { datacenter: 15 } }))).score).toBe(15);
  });

  it("velocity is judged against the network's per-minute limit", async () => {
    const c = cfg({ velocityPerMinute: 3 });
    for (let i = 0; i < 3; i++) expect((await signals({ ip: '203.0.113.9' }, c)).flags).toEqual([]);
    expect(await signals({ ip: '203.0.113.9' }, c)).toEqual({ score: 30, flags: ['high_velocity'] });
    // Counted per network: the same IP's clicks on another network don't count toward this one's limit.
    expect((await signals({ ip: '203.0.113.9', networkId: OTHER_NET }, c)).flags).toEqual([]);
  });

  it("an IPQS proxy flag cached for this network + IP raises the score (only on offers with IPQS on)", async () => {
    store.set(ipqsCacheKey(NET, '198.51.100.7'), JSON.stringify({ score: 12, flags: ['ipqs_proxy'] }));
    expect(await signals({ ipqs: true })).toEqual({ score: 30, flags: ['ipqs_proxy'] });
    expect(await signals({ ipqs: false })).toEqual({ score: 0, flags: [] });
    // Another network's paid lookup is not used.
    expect(await signals({ ipqs: true, networkId: OTHER_NET })).toEqual({ score: 0, flags: [] });
    // Weights apply to IPQS flags too.
    expect((await signals({ ipqs: true }, cfg({ weights: { ipqsProxy: 65 } }))).score).toBe(65);
  });

  it("IPQS's own fraud_score is a floor; Tor + bot verdicts stack with the click's other signals", async () => {
    store.set(ipqsCacheKey(NET, '198.51.100.7'), JSON.stringify({ score: 88, flags: [] }));
    expect(await signals({ ipqs: true })).toEqual({ score: 88, flags: [] });
    store.set(ipqsCacheKey(NET, '198.51.100.7'), JSON.stringify({ score: 5, flags: ['ipqs_tor', 'ipqs_bot'] }));
    expect(await signals({ ipqs: true, isDatacenter: true })).toEqual({ score: 100, flags: ['datacenter_ip', 'ipqs_tor', 'ipqs_bot'] });
  });

  it('a garbled cache entry is ignored', async () => {
    store.set(ipqsCacheKey(NET, '198.51.100.7'), '{not json');
    expect(await signals({ ipqs: true })).toEqual({ score: 0, flags: [] });
  });
});

describe('foldIpqsVerdict', () => {
  it('is idempotent: re-applying a verdict the click already carries changes nothing', () => {
    const w = DEFAULT_FRAUD_CONFIG.weights;
    const once = foldIpqsVerdict({ score: 50, flags: ['bot_user_agent'] }, { score: 10, flags: ['ipqs_vpn'] }, w);
    expect(once).toEqual({ score: 75, flags: ['bot_user_agent', 'ipqs_vpn'] });
    expect(foldIpqsVerdict(once, { score: 10, flags: ['ipqs_vpn'] }, w)).toEqual(once);
  });
});

describe('fraud-rules view + alert channels', () => {
  it('shows only the webhook origin, never its path or token; channels get the real URL', () => {
    const c = cfg({ alertEmails: ['ops@example.com'], alertWebhookUrl: encryptSecret('https://hooks.example.com/services/T00/B00/s3cr3t') });
    const view = fraudConfigView(c);
    expect(view.alertWebhookUrl).toBe('https://hooks.example.com/…');
    expect(view.alertWebhookUrlSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('s3cr3t');
    expect(fraudAlertChannels(NET, c)).toEqual({ emails: ['ops@example.com'], webhookUrl: 'https://hooks.example.com/services/T00/B00/s3cr3t' });
    expect(fraudConfigView(cfg())).toMatchObject({ alertWebhookUrl: null, alertWebhookUrlSet: false });
  });
});

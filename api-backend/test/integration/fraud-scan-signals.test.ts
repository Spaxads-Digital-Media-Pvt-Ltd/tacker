/**
 * The fraud scan alerts on every click signal, not only datacenter IPs — live DB (INTEGRATION_DB=1).
 * Bot traffic (bot / missing user agent, IPQS bot) and proxy / VPN / Tor traffic (IPQS verdicts) raise
 * their own alerts past the network's ratio thresholds; below them nothing is raised.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runFraudScan } from '../../src/lib/fraud/scan.js';
import { setFraudConfig } from '../../src/lib/fraud/rules.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('fraud scan: bot and proxy traffic alerts (live DB)', () => {
  /** `n` clicks for pubA1 carrying `flags`. */
  const clicks = async (fx: Fixture, n: number, flags: string[]) => query(
    `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, fraud_flags)
     SELECT $4 || g, $1, $2, $3, $5::text[] FROM generate_series(1, $6::int) g`,
    [fx.networkA, fx.offerA, fx.pubA1, `scan-${randomUUID().slice(0, 8)}-`, flags, n]);
  const alerts = async (fx: Fixture) => (await query<{ type: string; severity: string; metadata: Record<string, unknown> }>(
    `SELECT type, severity, metadata FROM alerts WHERE network_id = $1 ORDER BY type`, [fx.networkA])).rows;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
  });

  it('bot user agents, missing user agents and IPQS bot verdicts → one "bot_traffic" alert', async () => {
    const fx = await seedFixture(`scanbot-${randomUUID().slice(0, 8)}`);
    await clicks(fx, 6, ['bot_user_agent']);
    await clicks(fx, 2, ['no_user_agent']);
    await clicks(fx, 2, ['ipqs_bot']);
    await clicks(fx, 15, []);
    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(1);
    expect(await alerts(fx)).toEqual([
      expect.objectContaining({ type: 'bot_traffic', severity: 'high', metadata: expect.objectContaining({ clicks: 25, bot: 10, ratio: 0.4 }) }),
    ]);
  });

  it('proxy / VPN / Tor verdicts → one "proxy_traffic" alert', async () => {
    const fx = await seedFixture(`scanpx-${randomUUID().slice(0, 8)}`);
    await clicks(fx, 4, ['ipqs_proxy']);
    await clicks(fx, 3, ['ipqs_vpn', 'ipqs_proxy']);
    await clicks(fx, 1, ['ipqs_tor']);
    await clicks(fx, 17, []);
    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(1);
    expect(await alerts(fx)).toEqual([
      expect.objectContaining({ type: 'proxy_traffic', severity: 'medium', metadata: expect.objectContaining({ clicks: 25, proxy: 8, ratio: 0.32 }) }),
    ]);
  });

  it('the thresholds are the network’s: below them nothing is raised', async () => {
    const fx = await seedFixture(`scanth-${randomUUID().slice(0, 8)}`);
    await setFraudConfig(fx.networkA, { botRatioThreshold: 0.5, proxyRatioThreshold: 0.5 });
    await clicks(fx, 10, ['bot_user_agent']);
    await clicks(fx, 8, ['ipqs_vpn']);
    await clicks(fx, 7, []);
    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(0);
    expect(await alerts(fx)).toEqual([]);
  });
});

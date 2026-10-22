/**
 * The hourly advertiser digests — live DB + Redis (INTEGRATION_DB=1). "Advertiser Postback Received" and
 * "New Conversion Recorded" email each advertiser a summary of the previous whole hour: postbacks
 * recorded / held / refused (with why), conversions by status with approved revenue per currency. Off
 * until turned on; each network-hour once; quiet or email-less advertisers get nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { sendNetworkDigests, sendAdvertiserDigests, digestWindow } from '../../src/lib/email/advertiser-digest.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('advertiser digests (live DB + Redis)', () => {
  // A fixed past hour so reruns of the suite never collide with each other's Redis claims.
  const base = new Date(Date.UTC(2031, 0, 1 + Math.floor(Math.random() * 300), 10, 7));
  const now = new Date(base.getTime() + 3_600_000); // digest covers [10:00, 11:00) of that day
  const inHour = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 10, 30)).toISOString();

  const setup = async (toggles: Record<string, boolean>, email: string | null = 'adv@example.com') => {
    const fx = await seedFixture(`dig-${randomUUID().slice(0, 8)}`);
    await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [fx.networkA, JSON.stringify({
      smtp: { host: 'smtp.example.test', port: 587, username: 'u', password: 'p', fromEmail: 'n@example.test', fromName: 'N' },
      communicationHub: { systemEmails: toggles },
    })]);
    await query('UPDATE advertisers SET contact_email = $2, status = $3 WHERE id = $1', [fx.advA, email, 'active']);
    return fx;
  };
  const traffic = async (fx: Fixture) => {
    for (const [outcome, reason, n] of [['approved', null, 3], ['pending', 'manual_approval_required', 1], ['security_failed', 'bad_code', 2], ['duplicate', 'duplicate_transaction_id', 1]] as const) {
      for (let i = 0; i < n; i++) {
        await query(`INSERT INTO inbound_postback_logs (network_id, created_at, source, outcome, reason, advertiser_id, offer_id) VALUES ($1, $2, 'postback', $3, $4, $5, $6)`,
          [fx.networkA, inHour, outcome, reason, fx.advA, fx.offerA]);
      }
    }
    // An out-of-window row is not counted.
    await query(`INSERT INTO inbound_postback_logs (network_id, created_at, source, outcome, advertiser_id) VALUES ($1, $2, 'postback', 'approved', $3)`,
      [fx.networkA, new Date(base.getTime() - 7_200_000).toISOString(), fx.advA]);
    for (const [status, currency, revenue] of [['approved', 'USD', '8.50'], ['approved', 'USD', '1.25'], ['approved', 'EUR', '4'], ['pending', 'USD', '9']] as const) {
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, advertiser_id, source, status, payout, revenue, currency, created_at)
         VALUES ($1, $2, $3, $4, $5, 'postback', $6, 1, $7, $8, $9)`,
        [`dig-${randomUUID()}`, fx.networkA, `c-${randomUUID()}`, fx.offerA, fx.advA, status, revenue, currency, inHour]);
    }
  };
  const outbox = async (fx: Fixture) => (await query<{ event: string; recipient: string; subject: string; html: string }>(
    `SELECT event, recipient, subject, html FROM email_outbox WHERE network_id = $1 ORDER BY event`, [fx.networkA])).rows;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
  });

  it('the window is the previous whole UTC hour', () => {
    const w = digestWindow(new Date('2026-10-22T11:07:00Z'));
    expect([w.from.toISOString(), w.to.toISOString(), w.label]).toEqual(['2026-10-22T10:00:00.000Z', '2026-10-22T11:00:00.000Z', '2026-10-22 10:00–11:00 UTC']);
  });

  it('both on: one postback digest and one conversion digest to the advertiser, with the right numbers; once per hour', async () => {
    const fx = await setup({ advertiser_postback_received: true, new_conversion_recorded: true });
    await traffic(fx);
    expect(await sendNetworkDigests(fx.networkA, now)).toEqual({ postback: 1, conversion: 1 });
    const mails = await outbox(fx);
    expect(mails.map((m) => [m.event, m.recipient])).toEqual([['advertiser_postback_received', 'adv@example.com'], ['new_conversion_recorded', 'adv@example.com']]);
    const [pb, cv] = mails;
    expect(pb!.subject).toMatch(/7 postbacks received/);
    expect(pb!.html).toContain('4 recorded (1 held as pending)');
    expect(pb!.html).toContain('2 × security failed (bad code)');
    expect(pb!.html).toContain('1 × duplicate (duplicate transaction id)');
    expect(cv!.subject).toMatch(/4 new conversions/);
    expect(cv!.html).toMatch(/3 approved — revenue (9\.7500 USD, 4\.0000 EUR|4\.0000 EUR, 9\.7500 USD)/);
    expect(cv!.html).toContain('1 pending review');
    // Same hour again: claimed already, nothing more.
    expect(await sendNetworkDigests(fx.networkA, now)).toEqual({ postback: 0, conversion: 0 });
    expect(await outbox(fx)).toHaveLength(2);
  });

  it('off by default; only the one turned on is sent; no email on record → nothing', async () => {
    const off = await setup({});
    await traffic(off);
    expect(await sendNetworkDigests(off.networkA, now)).toEqual({ postback: 0, conversion: 0 });
    const list = (await request(buildDashboardApp()).get('/api/communication-hub/system-emails')
      .set(bearer(operatorToken({ userId: randomUUID(), networkId: off.networkA, role: 'admin' })))).body.data as { key: string; enabled: boolean }[];
    expect(list.find((e) => e.key === 'new_conversion_recorded')?.enabled).toBe(false);

    const one = await setup({ new_conversion_recorded: true });
    await traffic(one);
    expect(await sendNetworkDigests(one.networkA, now)).toEqual({ postback: 0, conversion: 1 });

    const noEmail = await setup({ advertiser_postback_received: true, new_conversion_recorded: true }, null);
    await traffic(noEmail);
    expect(await sendNetworkDigests(noEmail.networkA, now)).toEqual({ postback: 0, conversion: 0 });
  });

  it('the worker sweep finds the networks that turned a digest on', async () => {
    const fx = await setup({ advertiser_postback_received: true });
    await traffic(fx);
    const later = new Date(now.getTime() + 3_600_000 * 24 * 400); // another hour entirely: nothing in it
    const r = await sendAdvertiserDigests(later);
    expect(r.networks).toBeGreaterThanOrEqual(1);
    expect(await sendNetworkDigests(fx.networkA, now)).toEqual({ postback: 1, conversion: 0 });
  });
});

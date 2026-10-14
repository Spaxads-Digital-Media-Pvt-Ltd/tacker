/**
 * Retention keeps the money trail — on a real Postgres (INTEGRATION_DB=1, as in CI) — audit F-21.
 *
 *  - A conversion any ledger entry references (an earning, or one that was later reversed) is never
 *    pruned, however old; a conversion that never touched the ledger ages out with the window.
 *  - Clicks (and postback logs) still prune on their window — and a conversion whose click is gone
 *    keeps its money and ledger entries.
 *  - Windows are per network (Settings › Retention; 0 = keep forever), falling back to the defaults,
 *    and the settings API validates them (admin only).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { runRetention } from '../../src/lib/retention/retention.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('retention keeps the money trail (live DB)', () => {
  let dash: Express;
  const run = randomUUID().slice(0, 8);
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  const click = (fx: Fixture, id: string, days: number) => query(
    `INSERT INTO clicks (click_id, network_id, offer_id, created_at) VALUES ($1, $2, $3, $4)`, [`${run}-${id}`, fx.networkA, fx.offerA, ago(days)]);
  const conversion = (fx: Fixture, id: string, days: number, status: string, clickId: string | null = null) => query(
    `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, source, status, payout, revenue, currency, created_at)
     VALUES ($1, $2, $3, $4, $5, 'postback', $6, 5, 8, 'USD', $7)`,
    [`${run}-${id}`, fx.networkA, clickId ? `${run}-${clickId}` : `${run}-noclick-${id}`, fx.offerA, fx.pubA1, status, ago(days)]);
  const ledger = (fx: Fixture, convId: string, type: 'earning' | 'reversal', days: number) => query(
    `INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, idempotency_key, created_at)
     VALUES ($1, 'publisher', $2, $3, $4, $5, 5, 'USD', $6, $7)`,
    [fx.networkA, fx.pubA1, `${run}-${convId}`, type, type === 'earning' ? 'credit' : 'debit', `${run}-${convId}-${type}`, ago(days)]);
  const exists = async (table: 'clicks' | 'conversions', id: string) =>
    ((await query(`SELECT 1 FROM ${table} WHERE ${table === 'clicks' ? 'click_id' : 'conversion_id'} = $1`, [`${run}-${id}`])).rowCount ?? 0) > 0;
  const setRetention = (fx: Fixture, retention: Record<string, number>) => query(
    `UPDATE networks SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{retention}', $2::jsonb) WHERE id = $1`, [fx.networkA, JSON.stringify(retention)]);

  let a: Fixture;
  let keepClicks: Fixture;
  let custom: Fixture;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    dash = buildDashboardApp();
    // Defaults in the test env: clicks 90 days, conversions 400 days.
    a = await seedFixture(`ret-a-${run}`);
    await click(a, 'a-old', 100);                     // unattributed, past the click window
    await click(a, 'a-new', 10);
    await click(a, 'a-paid', 500);                    // the click behind a paid conversion
    await conversion(a, 'a-paid', 500, 'approved', 'a-paid');
    await ledger(a, 'a-paid', 'earning', 500);
    await conversion(a, 'a-reversed', 500, 'rejected');
    await ledger(a, 'a-reversed', 'earning', 500);
    await ledger(a, 'a-reversed', 'reversal', 499);
    await conversion(a, 'a-never', 500, 'rejected');  // never touched the ledger
    await conversion(a, 'a-recent', 10, 'pending');
    await query(`INSERT INTO postback_logs (network_id, conversion_id, publisher_id, url, attempt, success, created_at) VALUES ($1, $2, $3, 'https://x', 1, true, $4)`,
      [a.networkA, `${run}-a-paid`, a.pubA1, ago(100)]);

    keepClicks = await seedFixture(`ret-k-${run}`);
    await setRetention(keepClicks, { clickDays: 0 });
    await click(keepClicks, 'k-old', 1000);

    custom = await seedFixture(`ret-c-${run}`);
    await setRetention(custom, { clickDays: 200, conversionDays: 0 });
    await click(custom, 'c-100', 100);
    await click(custom, 'c-300', 300);
    await conversion(custom, 'c-never', 2000, 'rejected');

    await runRetention();
  });

  it('a conversion the ledger references is kept however old — earned, or earned and reversed; one that never touched it goes', async () => {
    expect(await exists('conversions', 'a-paid')).toBe(true);
    expect(await exists('conversions', 'a-reversed')).toBe(true);
    expect(await exists('conversions', 'a-never')).toBe(false);
    expect(await exists('conversions', 'a-recent')).toBe(true);
    const { rows } = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE network_id = $1`, [a.networkA]);
    expect(rows[0]!.n).toBe(3); // the ledger is never touched
  });

  it('clicks prune on their window; a paid conversion whose click is gone keeps its money and ledger entries', async () => {
    expect(await exists('clicks', 'a-old')).toBe(false);
    expect(await exists('clicks', 'a-paid')).toBe(false);
    expect(await exists('clicks', 'a-new')).toBe(true);
    const conv = (await query<{ payout: string; revenue: string; currency: string }>(
      `SELECT payout::text, revenue::text, currency FROM conversions WHERE conversion_id = $1`, [`${run}-a-paid`])).rows[0];
    expect(conv).toEqual({ payout: '5.0000', revenue: '8.0000', currency: 'USD' });
    const owed = (await query<{ net: string }>(
      `SELECT SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::text AS net FROM ledger_entries WHERE conversion_id = $1`, [`${run}-a-paid`])).rows[0]!;
    expect(owed.net).toBe('5.0000');
    expect((await query(`SELECT 1 FROM postback_logs WHERE network_id = $1`, [a.networkA])).rowCount).toBe(0); // operational, click window
  });

  it("per-network windows: a network's own settings win; 0 keeps forever", async () => {
    expect(await exists('clicks', 'k-old')).toBe(true);        // clickDays 0
    expect(await exists('clicks', 'c-100')).toBe(true);        // clickDays 200
    expect(await exists('clicks', 'c-300')).toBe(false);
    expect(await exists('conversions', 'c-never')).toBe(true); // conversionDays 0
  });

  it('the settings API shows the windows and validates changes (admin only)', async () => {
    const fx = await seedFixture(`ret-api-${run}`);
    const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
    const got = await request(dash).get('/api/settings').set(admin);
    expect(got.body.data.retention).toEqual({
      clickDays: null, conversionDays: null, effective: { clickDays: 90, conversionDays: 400 },
      defaults: { clickDays: 90, conversionDays: 400 }, ledgeredConversions: 'kept forever',
    });
    for (const body of [{ clickDays: 10 }, { conversionDays: 30 }, { clickDays: -1 }, { conversionDays: 4000 }]) {
      expect((await request(dash).put('/api/settings/retention').set(admin).send(body)).status, JSON.stringify(body)).toBe(422);
    }
    const saved = await request(dash).put('/api/settings/retention').set(admin).send({ clickDays: 0, conversionDays: 730 });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ clickDays: 0, conversionDays: 730, effective: { clickDays: 0, conversionDays: 730 } });
    const reset = await request(dash).put('/api/settings/retention').set(admin).send({ clickDays: null });
    expect(reset.body.data).toMatchObject({ clickDays: null, effective: { clickDays: 90, conversionDays: 730 } });
    const audit = await query(`SELECT 1 FROM audit_log WHERE network_id = $1 AND action = 'settings.retention.update'`, [fx.networkA]);
    expect(audit.rowCount).toBe(2);
    for (const role of ['manager', 'read_only']) {
      const auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));
      expect((await request(dash).put('/api/settings/retention').set(auth).send({ clickDays: 0 })).status).toBe(403);
    }
  });
});

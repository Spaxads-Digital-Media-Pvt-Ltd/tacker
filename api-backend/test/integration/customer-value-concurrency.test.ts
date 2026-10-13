/**
 * Customer Value rules under concurrent conversions (live DB + Redis; INTEGRATION_DB=1).
 *
 * H1: the "already fired?" check ran outside the conversion transaction, so two conversions for the
 * same customer recorded at once could both get a once-per-customer override and both record a
 * firing. Evaluation now runs inside the transaction after a per-customer advisory lock
 * (cvcust(network, user_id), 5 s lock timeout), on the transaction's own connection.
 *
 * Everything goes through the real /click and recordConversion(); each scenario has its own network.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { recordConversion, type RecordConversionInput } from '../../src/surfaces/tracking/conversions/record.js';
import * as cv from '../../src/lib/customer-value/evaluate.js';
import { getRedis } from '../../src/lib/redis.js';
import { pool, query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

const OVERRIDE = '12.3456';
const BASE_PAYOUT = '5.0000'; // seedFixture's offer default payout

interface Env { fx: Fixture; host: string; ruleId: string }

d('Customer Value under concurrent conversions (live DB + Redis)', () => {
  let track: FastifyInstance;

  /** A fresh network (seedFixture's network A) with its own tracking host and one active rule. */
  async function mkEnv(rule: { outcome?: 'once_per_customer' | 'every_cycle'; recurring?: boolean } = {}, offerCaps: { total?: number } = {}): Promise<Env> {
    const fx = await seedFixture(`cvc-${randomUUID().slice(0, 8)}`);
    const host = `cvc-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    // Set before the first click so the cached offer config already carries it.
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}', total_conversion_cap = $2 WHERE id = $1`, [fx.offerA, offerCaps.total ?? null]);
    const recurring = rule.recurring ?? false;
    const ruleId = (await query<{ id: string }>(
      `INSERT INTO customer_value_rules (network_id, name, status, goal_cycle, recurring_duration, continuous_mode, outcome_frequency, payout_value)
       VALUES ($1, 'Concurrency rule', 'active', $2, $3, $4, $5, $6) RETURNING id`,
      [fx.networkA, recurring ? 'recurring' : 'continuous', recurring ? 'daily' : null, recurring ? null : 'for_rule_duration',
        rule.outcome ?? 'once_per_customer', OVERRIDE])).rows[0]!.id;
    return { fx, host, ruleId };
  }
  const click = async (env: Env): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${env.fx.offerA}&pub_id=${env.fx.pubA1}`, headers: { host: env.host } });
    expect(r.statusCode).toBe(302);
    return new URL((r.headers.location as string).replace('{click_id}', '')).pathname.split('/').pop()!;
  };
  const input = (env: Env, clickId: string, over: Partial<RecordConversionInput> = {}): RecordConversionInput => ({
    networkId: env.fx.networkA, clickId, txnId: `txn-${randomUUID()}`, event: null, statusHint: 'approved',
    payoutParam: null, revenueParam: null, secureCode: null, skipSecureCode: true, source: 'postback', rawParams: {}, ...over,
  });
  const firings = async (env: Env, userId: string) => (await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM customer_value_rule_firings WHERE network_id = $1 AND rule_id = $2 AND user_id = $3`,
    [env.fx.networkA, env.ruleId, userId])).rows[0]!.n;
  const conversionsFor = async (env: Env, userId: string) => (await query<{ conversion_id: string; status: string; payout: string }>(
    `SELECT conversion_id, status, payout::text AS payout FROM conversions WHERE network_id = $1 AND raw_params->>'user_id' = $2`,
    [env.fx.networkA, userId])).rows;
  /** Publisher earning ledger amount per conversion (exact text). */
  const earnings = async (env: Env, conversionIds: string[]) => new Map((await query<{ conversion_id: string; amount: string }>(
    `SELECT conversion_id, amount::text AS amount FROM ledger_entries WHERE network_id = $1 AND conversion_id = ANY($2) AND entry_type = 'earning'`,
    [env.fx.networkA, conversionIds])).rows.map((r) => [r.conversion_id, r.amount]));

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
  });
  afterAll(async () => { await track?.close(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('core race: 10 simultaneous conversions for one customer → exactly 1 firing and 1 overridden payout (20 rounds)', async () => {
    const env = await mkEnv();
    const failures: string[] = [];
    for (let round = 0; round < 20; round++) {
      const user = `race-${round}-${randomUUID().slice(0, 6)}`;
      const clicks = await Promise.all(Array.from({ length: 10 }, () => click(env)));
      const results = await Promise.all(clicks.map((c) => recordConversion(input(env, c, { rawParams: { user_id: user } }))));
      const convs = await conversionsFor(env, user);
      const overridden = convs.filter((c) => c.payout === OVERRIDE).length;
      const fired = await firings(env, user);
      if (fired !== 1 || overridden !== 1 || convs.length !== 10 || results.some((r) => r.outcome !== 'approved')) {
        failures.push(`round ${round}: firings=${fired} overridden=${overridden} conversions=${convs.length} outcomes=${results.map((r) => r.outcome).join(',')}`);
      }
      // Ledger = the payout actually recorded, override or not.
      const led = await earnings(env, convs.map((c) => c.conversion_id));
      for (const c of convs) if (led.get(c.conversion_id) !== c.payout) failures.push(`round ${round}: ledger ${led.get(c.conversion_id)} ≠ payout ${c.payout}`);
      expect(convs.filter((c) => c.payout === BASE_PAYOUT).length + overridden).toBe(convs.length);
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('every cycle (recurring daily): simultaneous conversions in one window → 1 firing', async () => {
    const env = await mkEnv({ outcome: 'every_cycle', recurring: true });
    const user = `cycle-${randomUUID().slice(0, 6)}`;
    const clicks = await Promise.all(Array.from({ length: 8 }, () => click(env)));
    await Promise.all(clicks.map((c) => recordConversion(input(env, c, { rawParams: { user_id: user } }))));
    expect(await firings(env, user)).toBe(1);
    expect((await conversionsFor(env, user)).filter((c) => c.payout === OVERRIDE)).toHaveLength(1);
  }, 60_000);

  it('cap 1, two customers at once: one approved and fired; the other rejected with no firing and no ledger', async () => {
    const env = await mkEnv({}, { total: 1 });
    const [c1, c2] = await Promise.all([click(env), click(env)]);
    const users = [`cap-a-${randomUUID().slice(0, 6)}`, `cap-b-${randomUUID().slice(0, 6)}`];
    const results = await Promise.all([recordConversion(input(env, c1!, { rawParams: { user_id: users[0] } })), recordConversion(input(env, c2!, { rawParams: { user_id: users[1] } }))]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['approved', 'rejected']);
    const approvedUser = results[0]!.outcome === 'approved' ? users[0]! : users[1]!;
    const rejectedUser = approvedUser === users[0] ? users[1]! : users[0]!;
    expect(await firings(env, approvedUser)).toBe(1);
    expect(await firings(env, rejectedUser)).toBe(0);
    const rej = await conversionsFor(env, rejectedUser);
    expect(rej.map((c) => c.status)).toEqual(['rejected']);
    expect((await earnings(env, rej.map((c) => c.conversion_id))).size).toBe(0);
  }, 60_000);

  it('the same postback (same transaction id) sent 5 times at once → 1 conversion, 1 firing', async () => {
    const env = await mkEnv();
    const c = await click(env);
    const user = `dup-${randomUUID().slice(0, 6)}`;
    vi.spyOn(getRedis(), 'set').mockResolvedValue('OK' as never); // every attempt past the Redis guard
    const same = input(env, c, { txnId: `txn-dup-${randomUUID()}`, rawParams: { user_id: user } });
    const results = await Promise.all(Array.from({ length: 5 }, () => recordConversion(same)));
    expect(results.filter((r) => r.outcome === 'approved')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(4);
    expect(await conversionsFor(env, user)).toHaveLength(1);
    expect(await firings(env, user)).toBe(1);
  }, 60_000);

  it('no user_id: conversions at once are recorded normally, no override, no firing', async () => {
    const env = await mkEnv();
    const clicks = await Promise.all(Array.from({ length: 5 }, () => click(env)));
    const results = await Promise.all(clicks.map((c) => recordConversion(input(env, c))));
    expect(results.every((r) => r.outcome === 'approved')).toBe(true);
    const { rows } = await query<{ payout: string }>(`SELECT payout::text AS payout FROM conversions WHERE network_id = $1 AND click_id = ANY($2)`, [env.fx.networkA, clicks]);
    expect(rows.map((r) => r.payout)).toEqual(Array(5).fill(BASE_PAYOUT));
    expect((await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM customer_value_rule_firings WHERE network_id = $1`, [env.fx.networkA])).rows[0]!.n).toBe(0);
  }, 60_000);

  it('the same user_id in two networks at once: each network fires its own rule once', async () => {
    const [a, b] = await Promise.all([mkEnv(), mkEnv()]);
    const user = `shared-${randomUUID().slice(0, 6)}`;
    const ca = await Promise.all(Array.from({ length: 4 }, () => click(a!)));
    const cb = await Promise.all(Array.from({ length: 4 }, () => click(b!)));
    await Promise.all([...ca.map((c) => recordConversion(input(a!, c, { rawParams: { user_id: user } }))), ...cb.map((c) => recordConversion(input(b!, c, { rawParams: { user_id: user } })))]);
    expect(await firings(a!, user)).toBe(1);
    expect(await firings(b!, user)).toBe(1);
  }, 60_000);

  it('mixed load on one capped offer (distinct customers, one repeat customer, same-click repeats) → no errors, one firing each', async () => {
    const env = await mkEnv({}, { total: 1000 });
    const distinct = Array.from({ length: 8 }, (_, i) => `mix-${i}-${randomUUID().slice(0, 6)}`);
    const repeat = `mix-rep-${randomUUID().slice(0, 6)}`;
    const sameClick = await click(env);
    const tasks = [
      ...await Promise.all(distinct.map(async (u) => input(env, await click(env), { rawParams: { user_id: u } }))),
      ...await Promise.all(Array.from({ length: 6 }, async () => input(env, await click(env), { rawParams: { user_id: repeat } }))),
      // Same click + event without a transaction id: one conversion (convnotxn lock + check).
      ...Array.from({ length: 6 }, () => input(env, sameClick, { txnId: null, event: 'sale', rawParams: { user_id: `mix-same-${sameClick}` } })),
    ];
    vi.spyOn(getRedis(), 'set').mockResolvedValue('OK' as never);
    const settled = await Promise.allSettled(tasks.map((t) => recordConversion(t)));
    expect(settled.filter((s) => s.status === 'rejected')).toEqual([]); // no thrown errors (deadlocks, timeouts)
    for (const u of [...distinct, repeat]) expect(await firings(env, u), u).toBe(1);
    expect(await firings(env, `mix-same-${sameClick}`)).toBe(1);
    expect(await conversionsFor(env, `mix-same-${sameClick}`)).toHaveLength(1);
  }, 120_000);

  it('lock timeout: with the customer lock held elsewhere, recording fails after ~5 s, commits nothing, and a retry then succeeds', async () => {
    const env = await mkEnv();
    const user = `lock-${randomUUID().slice(0, 6)}`;
    const key = JSON.stringify(['cvcust', env.fx.networkA, user]);
    // The implementation's key must be this exact value (if the helper exists).
    const keyFn = (cv as Record<string, unknown>)['customerValueLockKey'] as ((n: string, u: string) => string) | undefined;
    if (keyFn) expect(keyFn(env.fx.networkA, user)).toBe(key);
    const c = await click(env);
    const conv = input(env, c, { rawParams: { user_id: user } });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const t0 = Date.now();
      await expect(recordConversion(conv)).rejects.toThrow();
      const waited = Date.now() - t0;
      expect(waited).toBeGreaterThanOrEqual(4_500);
      expect(waited).toBeLessThan(15_000);
      expect(await conversionsFor(env, user)).toHaveLength(0);
      expect(await firings(env, user)).toBe(0);
      // The idempotency key was released, so the advertiser's retry is not answered "duplicate".
      expect(await getRedis().get(`convidem:${c}:${conv.txnId}`)).toBeNull();
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const retry = await recordConversion(conv);
    expect(retry.outcome).toBe('approved');
    expect(await firings(env, user)).toBe(1);
    expect((await conversionsFor(env, user)).map((x) => x.payout)).toEqual([OVERRIDE]);
  }, 60_000);
});

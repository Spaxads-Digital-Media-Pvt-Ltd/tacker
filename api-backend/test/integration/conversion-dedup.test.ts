/**
 * Conversion dedup + idempotency-key recovery on a real Postgres + Redis (INTEGRATION_DB=1):
 *  - Fix A: without a transaction id, one conversion per (network, click, event) — permanently, not
 *    only while the 48h Redis key lives — also under concurrent attempts (advisory lock + check).
 *  - Fix B: a failed database write frees the attempt's own Redis idempotency key, so a retry
 *    records the conversion exactly once; another request's key and a recorded conversion's key
 *    are never removed; a cleanup failure never masks the original error.
 * Transaction-id dedup and distinct events keep their existing behaviour.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { recordConversion, type RecordConversionInput } from '../../src/surfaces/tracking/conversions/record.js';
import { getRedis } from '../../src/lib/redis.js';
import { pool, query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('conversion dedup without a transaction id + idempotency-key recovery (live DB + Redis)', () => {
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;

  const click = async (): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    return new URL((r.headers.location as string).replace('{click_id}', '')).pathname.split('/').pop()!;
  };
  const postback = async (qs: string) =>
    (await track.inject({ method: 'GET', url: `/postback?${qs}`, headers: { host } })).json() as { status: string; conversion_id: string | null };
  const input = (clickId: string, over: Partial<RecordConversionInput> = {}): RecordConversionInput => ({
    networkId: fx.networkA, clickId, txnId: null, event: null, statusHint: 'approved', payoutParam: null,
    revenueParam: null, secureCode: null, skipSecureCode: true, source: 'postback', rawParams: {}, ...over,
  });
  const convCount = async (clickId: string) => (await query<{ n: number }>(`SELECT COUNT(*)::int n FROM conversions WHERE click_id = $1`, [clickId])).rows[0]!.n;
  const ledgerForClick = async (clickId: string) => (await query<{ n: number }>(
    `SELECT COUNT(*)::int n FROM ledger_entries l JOIN conversions c ON c.conversion_id = l.conversion_id AND c.network_id = l.network_id WHERE c.click_id = $1`,
    [clickId])).rows[0]!.n;
  const idemKey = (clickId: string, k = 'default') => `convidem:${clickId}:${k}`;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`dedup-${randomUUID().slice(0, 8)}`);
    host = `dedup-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('Fix A — no transaction id: one conversion per (network, click, event)', () => {
    it('a repeat after the 48h Redis key expires is a duplicate: one conversion, no extra ledger entries', async () => {
      const c = await click();
      const first = await postback(`click_id=${c}&status=approved`);
      expect(first.status).toBe('approved');
      expect(await ledgerForClick(c)).toBe(2);
      expect((await postback(`click_id=${c}&status=approved`)).status).toBe('duplicate'); // Redis, within 48h
      await getRedis().del(idemKey(c)); // the 48h TTL has run out
      expect((await postback(`click_id=${c}&status=approved`)).status).toBe('duplicate'); // DB check
      expect(await convCount(c)).toBe(1);
      expect(await ledgerForClick(c)).toBe(2);
    });

    it('a REJECTED original cannot be replaced by a later approved repeat (was: a second, approved conversion)', async () => {
      const c = await click();
      const first = await postback(`click_id=${c}&event=lead&status=rejected`);
      expect(first.status).toBe('rejected');
      await getRedis().del(idemKey(c, 'lead'));
      expect((await postback(`click_id=${c}&event=lead&status=approved`)).status).toBe('duplicate');
      expect(await convCount(c)).toBe(1);
      expect(await ledgerForClick(c)).toBe(0);
    });

    it('concurrent attempts for the same click + event create exactly one conversion (Redis guard bypassed)', async () => {
      const c = await click();
      // Make every attempt get past the Redis NX guard, so only the DB lock + check protects.
      vi.spyOn(getRedis(), 'set').mockResolvedValue('OK' as never);
      const results = await Promise.all(Array.from({ length: 6 }, () => recordConversion(input(c, { event: 'sale' }))));
      const outcomes = results.map((r) => r.outcome).sort();
      expect(outcomes.filter((o) => o === 'approved')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(5);
      expect(await convCount(c)).toBe(1);
      expect(await ledgerForClick(c)).toBe(2);
    });

    it('distinct events on the same click still convert separately (incl. no event vs a named event)', async () => {
      const c = await click();
      expect((await postback(`click_id=${c}&status=approved`)).status).toBe('approved');
      expect((await postback(`click_id=${c}&event=signup&status=approved`)).status).toBe('approved');
      expect((await postback(`click_id=${c}&event=purchase&status=approved`)).status).toBe('approved');
      expect(await convCount(c)).toBe(3);
      // …and each is deduped on its own after the Redis keys expire.
      for (const k of ['default', 'signup', 'purchase']) await getRedis().del(idemKey(c, k));
      expect((await postback(`click_id=${c}&event=signup&status=approved`)).status).toBe('duplicate');
      expect(await convCount(c)).toBe(3);
    });

    it('event names are matched exactly (case-sensitive, like the Redis key)', async () => {
      const c = await click();
      expect((await postback(`click_id=${c}&event=Sale&status=approved`)).status).toBe('approved');
      expect((await postback(`click_id=${c}&event=sale&status=approved`)).status).toBe('approved');
      expect(await convCount(c)).toBe(2);
    });

    it('tenant scope: a conversion in ANOTHER network with the same click id + event does not block', async () => {
      const c = await click();
      // A foreign network's no-transaction-id row that happens to share the click id + event (contrived,
      // but proves the check is scoped by network_id).
      const offerB = (await query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'B offer', 'active', 'https://example.com') RETURNING id`,
        [fx.networkB, fx.advB])).rows[0]!.id;
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, status, source, event_name, raw_params)
         VALUES ($1, $2, $3, $4, 'approved', 'postback', 'x-scope', '{}')`,
        [randomUUID().replace(/-/g, ''), fx.networkB, c, offerB]);
      expect((await postback(`click_id=${c}&event=x-scope&status=approved`)).status).toBe('approved');
      expect((await query<{ n: number }>(`SELECT COUNT(*)::int n FROM conversions WHERE click_id = $1 AND network_id = $2`, [c, fx.networkA])).rows[0]!.n).toBe(1);
    });

    it('unchanged: the same transaction id is a duplicate (Redis, then the DB unique index); different ids both convert', async () => {
      const c = await click();
      expect((await postback(`click_id=${c}&txn_id=T-A&status=approved`)).status).toBe('approved');
      expect((await postback(`click_id=${c}&txn_id=T-A&status=approved`)).status).toBe('duplicate');
      await getRedis().del(idemKey(c, 'T-A'));
      expect((await postback(`click_id=${c}&txn_id=T-A&status=approved`)).status).toBe('duplicate');
      expect((await postback(`click_id=${c}&txn_id=T-B&status=approved`)).status).toBe('approved');
      expect(await convCount(c)).toBe(2);
      expect(await ledgerForClick(c)).toBe(4);
    });

    it('unchanged: a transaction-id conversion does not block a no-transaction-id conversion for the same event', async () => {
      const c = await click();
      expect((await postback(`click_id=${c}&txn_id=T-C&event=sale&status=approved`)).status).toBe('approved');
      expect((await postback(`click_id=${c}&event=sale&status=approved`)).status).toBe('approved');
      expect(await convCount(c)).toBe(2);
    });
  });

  describe('Fix B — a failed DB write frees the attempt\'s own idempotency key', () => {
    /** Wrap pool.connect so the next `INSERT INTO conversions` fails once (optionally running a hook first). */
    const failNextConversionInsert = (beforeThrow?: () => Promise<void>) => {
      const realConnect = pool.connect.bind(pool);
      let armed = true;
      vi.spyOn(pool, 'connect').mockImplementation((async (cb?: unknown) => {
        // pool.query() checks out clients with the callback form — pass those through untouched.
        if (typeof cb === 'function') return (realConnect as unknown as (c: unknown) => void)(cb);
        const client = (await realConnect()) as PoolClient;
        const original = client.query;
        const realQuery = original.bind(client) as (...a: unknown[]) => unknown;
        // Forward EVERY call shape (pg-pool's own pool.query() uses the callback form on reused
        // clients); fail only the next conversion insert, then put the original method back so no
        // wrapped client is returned to the pool.
        (client as unknown as { query: unknown }).query = ((...args: unknown[]) => {
          const sql = args[0];
          if (armed && typeof sql === 'string' && sql.includes('INSERT INTO conversions')) {
            armed = false;
            (client as unknown as { query: unknown }).query = original;
            return (async () => {
              if (beforeThrow) await beforeThrow();
              throw new Error('simulated database failure');
            })();
          }
          return realQuery(...args);
        }) as never;
        return client;
      }) as never);
    };

    it('after a failed write the key is released; the retry records the conversion exactly once with its ledger entries', async () => {
      const c = await click();
      failNextConversionInsert();
      await expect(recordConversion(input(c, { txnId: 'FB-1' }))).rejects.toThrow('simulated database failure');
      expect(await getRedis().get(idemKey(c, 'FB-1'))).toBeNull();
      expect(await convCount(c)).toBe(0);
      vi.restoreAllMocks();
      const retry = await recordConversion(input(c, { txnId: 'FB-1' }));
      expect(retry.outcome).toBe('approved');
      expect((await recordConversion(input(c, { txnId: 'FB-1' }))).outcome).toBe('duplicate');
      expect(await convCount(c)).toBe(1);
      expect(await ledgerForClick(c)).toBe(2);
    });

    it('the same holds without a transaction id (retry converts once; later repeats are duplicates)', async () => {
      const c = await click();
      failNextConversionInsert();
      await expect(recordConversion(input(c, { event: 'buy' }))).rejects.toThrow('simulated database failure');
      expect(await getRedis().get(idemKey(c, 'buy'))).toBeNull();
      vi.restoreAllMocks();
      expect((await recordConversion(input(c, { event: 'buy' }))).outcome).toBe('approved');
      await getRedis().del(idemKey(c, 'buy'));
      expect((await recordConversion(input(c, { event: 'buy' }))).outcome).toBe('duplicate');
      expect(await convCount(c)).toBe(1);
      expect(await ledgerForClick(c)).toBe(2);
    });

    it('never removes a key now held by a different request', async () => {
      const c = await click();
      const key = idemKey(c, 'FB-2');
      failNextConversionInsert(async () => { await getRedis().set(key, 'someone-else', 'EX', 60); });
      await expect(recordConversion(input(c, { txnId: 'FB-2' }))).rejects.toThrow('simulated database failure');
      expect(await getRedis().get(key)).toBe('someone-else');
      await getRedis().del(key);
    });

    it('a cleanup failure never masks the original database error', async () => {
      const c = await click();
      failNextConversionInsert();
      vi.spyOn(getRedis(), 'eval').mockRejectedValue(new Error('redis down') as never);
      await expect(recordConversion(input(c, { txnId: 'FB-3' }))).rejects.toThrow('simulated database failure');
      vi.restoreAllMocks();
      await getRedis().del(idemKey(c, 'FB-3'));
    });

    it('a recorded conversion keeps its key (duplicates stay duplicates; nothing is reopened)', async () => {
      const c = await click();
      expect((await recordConversion(input(c, { txnId: 'FB-4' }))).outcome).toBe('approved');
      const token = await getRedis().get(idemKey(c, 'FB-4'));
      expect(token).toBeTruthy();
      expect((await recordConversion(input(c, { txnId: 'FB-4' }))).outcome).toBe('duplicate');
      expect(await getRedis().get(idemKey(c, 'FB-4'))).toBe(token);
    });
  });
});

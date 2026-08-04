/**
 * Ledger money-math tests (spec §8, non-negotiable #2). Runs when INTEGRATION_DB=1 (CI against the
 * throwaway DB). Asserts: dual entry, balances match hand-computed values, reversal nets to zero
 * while preserving history, payout draws the balance to zero, retries are idempotent, and the DB
 * refuses UPDATE/DELETE on ledger_entries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PoolClient } from 'pg';
import { pool, query, closeDb } from '../../src/lib/db/pool.js';
import {
  writeConversionLedger, reverseConversionLedger, accountBalance, createPayoutRun,
} from '../../src/lib/ledger/ledger.js';
import { reconcileLedger } from '../../src/lib/ledger/reconcile.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

async function inTx(fn: (c: PoolClient) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

d('Ledger (live DB)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres unreachable');
    await resetDb();
    fx = await seedFixture();
  });
  afterAll(async () => { await closeDb(); });

  it('writes dual entries and derives correct balances', async () => {
    await inTx((c) => writeConversionLedger(c, {
      networkId: fx.networkA, conversionId: 'conv-1', publisherId: fx.pubA1, advertiserId: fx.advA,
      payout: '5.0000', revenue: '8.0000', currency: 'USD',
    }));
    // publisher earning credit +5; advertiser billing debit -8 (spec §8 convention).
    expect(await accountBalance(fx.networkA, 'publisher', fx.pubA1)).toBe('5.0000');
    expect(await accountBalance(fx.networkA, 'advertiser', fx.advA)).toBe('-8.0000');
  });

  it('is idempotent on retry (no double-count)', async () => {
    await inTx((c) => writeConversionLedger(c, {
      networkId: fx.networkA, conversionId: 'conv-1', publisherId: fx.pubA1, advertiserId: fx.advA,
      payout: '5.0000', revenue: '8.0000', currency: 'USD',
    }));
    expect(await accountBalance(fx.networkA, 'publisher', fx.pubA1)).toBe('5.0000');
  });

  it('reversal nets to zero while preserving history', async () => {
    await reverseConversionLedger(fx.networkA, 'conv-1', 'test');
    expect(await accountBalance(fx.networkA, 'publisher', fx.pubA1)).toBe('0.0000');
    expect(await accountBalance(fx.networkA, 'advertiser', fx.advA)).toBe('0.0000');
    // History preserved: earning + reversal both present (4 entries total for conv-1).
    const { rows } = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ledger_entries WHERE conversion_id = 'conv-1'`,
    );
    expect(Number(rows[0]!.n)).toBe(4);
  });

  it('payout run draws the balance to zero and records a payout', async () => {
    await inTx((c) => writeConversionLedger(c, {
      networkId: fx.networkA, conversionId: 'conv-2', publisherId: fx.pubA1, advertiserId: fx.advA,
      payout: '12.5000', revenue: '20.0000', currency: 'USD',
    }));
    expect(await accountBalance(fx.networkA, 'publisher', fx.pubA1)).toBe('12.5000');

    const result = await createPayoutRun(fx.networkA, { publisherIds: [fx.pubA1] });
    expect(result.total).toBe('12.5000');
    expect(await accountBalance(fx.networkA, 'publisher', fx.pubA1)).toBe('0.0000');

    const { rows } = await query<{ amount: string }>(
      `SELECT amount FROM payouts WHERE network_id = $1 AND publisher_id = $2`, [fx.networkA, fx.pubA1],
    );
    expect(rows[0]!.amount).toBe('12.5000');
  });

  it('reconciliation reports no drift', async () => {
    expect(await reconcileLedger()).toEqual([]);
  });

  it('refuses UPDATE and DELETE on ledger_entries (append-only)', async () => {
    await expect(query(`UPDATE ledger_entries SET amount = 0 WHERE conversion_id = 'conv-2'`))
      .rejects.toThrow(/append-only/);
    await expect(query(`DELETE FROM ledger_entries WHERE conversion_id = 'conv-2'`))
      .rejects.toThrow(/append-only/);
  });
});

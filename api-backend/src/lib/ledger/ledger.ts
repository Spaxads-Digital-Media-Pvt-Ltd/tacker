/**
 * Append-only money ledger (spec §8 — money-critical). Balances are DERIVED by summing entries;
 * corrections are new offsetting entries, never edits (the DB also blocks UPDATE/DELETE). All
 * amounts are numeric strings — NEVER floats. Every write is idempotent via idempotency_key, so a
 * retried job never double-counts.
 *
 * Account/direction convention (per spec §8):
 *  - publisher earning  → CREDIT the publisher (we owe them more)
 *  - advertiser billing → DEBIT the advertiser  (they owe us)
 *  - publisher payout   → DEBIT the publisher   (draws their balance down)
 *  - reversal offsets the original with the opposite direction (net effect zero, history preserved)
 * Balance = SUM(credit) − SUM(debit) over an account (filtered by status).
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query } from '../db/pool.js';

export type AccountType = 'publisher' | 'advertiser';
type EntryType = 'earning' | 'billing' | 'reversal' | 'adjustment' | 'payout';
type Direction = 'credit' | 'debit';
type Status = 'pending' | 'approved' | 'rejected';

interface EntryInput {
  networkId: string;
  accountType: AccountType;
  accountId: string;
  conversionId?: string | null;
  entryType: EntryType;
  direction: Direction;
  amount: string;
  currency: string;
  status?: Status;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

/** Insert one entry idempotently. Returns true if newly written, false if the key already existed. */
async function insertEntry(client: PoolClient, e: EntryInput): Promise<boolean> {
  const res = await client.query(
    `INSERT INTO ledger_entries
       (network_id, account_type, account_id, conversion_id, entry_type, direction, amount,
        currency, status, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [
      e.networkId, e.accountType, e.accountId, e.conversionId ?? null, e.entryType, e.direction,
      e.amount, e.currency, e.status ?? 'approved', e.idempotencyKey, JSON.stringify(e.metadata ?? {}),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

const positive = (v: string | null | undefined): boolean => v != null && Number(v) > 0;

/**
 * Dual-entry for an APPROVED conversion (spec §8): publisher earning credit + advertiser billing
 * debit, same conversion_id, in the CALLER'S transaction. Idempotent on conversion_id.
 */
export async function writeConversionLedger(
  client: PoolClient,
  args: {
    networkId: string; conversionId: string;
    publisherId: string | null; advertiserId: string | null;
    payout: string | null; revenue: string | null; currency: string;
  },
): Promise<void> {
  if (args.publisherId && positive(args.payout)) {
    await insertEntry(client, {
      networkId: args.networkId, accountType: 'publisher', accountId: args.publisherId,
      conversionId: args.conversionId, entryType: 'earning', direction: 'credit',
      amount: args.payout!, currency: args.currency, idempotencyKey: `conv-earning:${args.conversionId}`,
      metadata: { conversion_id: args.conversionId },
    });
  }
  if (args.advertiserId && positive(args.revenue)) {
    await insertEntry(client, {
      networkId: args.networkId, accountType: 'advertiser', accountId: args.advertiserId,
      conversionId: args.conversionId, entryType: 'billing', direction: 'debit',
      amount: args.revenue!, currency: args.currency, idempotencyKey: `conv-billing:${args.conversionId}`,
      metadata: { conversion_id: args.conversionId },
    });
  }
}

/**
 * Reverse a conversion's ledger effect (spec §8): write offsetting entries — do NOT delete the
 * originals. Net effect becomes zero while history shows both. Idempotent.
 */
export async function reverseConversionLedger(networkId: string, conversionId: string, reason: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      account_type: AccountType; account_id: string; direction: Direction; amount: string; currency: string;
    }>(
      `SELECT account_type, account_id, direction, amount, currency
         FROM ledger_entries
        WHERE network_id = $1 AND conversion_id = $2 AND entry_type IN ('earning', 'billing')`,
      [networkId, conversionId],
    );
    for (const o of rows) {
      await insertEntry(client, {
        networkId, accountType: o.account_type, accountId: o.account_id, conversionId,
        entryType: 'reversal',
        direction: o.direction === 'credit' ? 'debit' : 'credit', // opposite to offset
        amount: o.amount, currency: o.currency,
        idempotencyKey: `conv-reversal:${o.account_type}:${conversionId}`,
        metadata: { conversion_id: conversionId, reason },
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Balance = SUM(credit) − SUM(debit) for an account, filtered by status. Returns a numeric string. */
export async function accountBalance(
  networkId: string, accountType: AccountType, accountId: string, status: Status = 'approved',
): Promise<string> {
  const { rows } = await query<{ bal: string }>(
    `SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END), 0)::numeric(14,4) AS bal
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = $2 AND account_id = $3 AND status = $4`,
    [networkId, accountType, accountId, status],
  );
  return rows[0]?.bal ?? '0.0000';
}

export interface PayoutRunResult {
  batchId: string;
  currency: string;
  total: string;
  lines: { publisherId: string; amount: string }[];
}

/**
 * Create a payout run (spec §8): sum each eligible publisher's approved payable balance, create a
 * batch + a payout line + a ledger 'payout' debit (drawing the balance to zero), all in ONE
 * transaction. FX rate is frozen on the batch. Idempotent per payout line via `payout:{id}`.
 */
export async function createPayoutRun(
  networkId: string,
  opts: { publisherIds?: string[]; createdBy?: string; note?: string; currency?: string } = {},
): Promise<PayoutRunResult> {
  const currency = opts.currency ?? 'USD';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const batch = (await client.query<{ id: string }>(
      `INSERT INTO payout_batches (network_id, status, currency, fx_rate, note, created_by)
       VALUES ($1, 'paid', $2, 1, $3, $4) RETURNING id`,
      [networkId, currency, opts.note ?? null, opts.createdBy ?? null],
    )).rows[0]!;

    // Publishers with a positive approved balance (optionally restricted to a set).
    const balances = await client.query<{ account_id: string; bal: string }>(
      `SELECT account_id,
              SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::numeric(14,4) AS bal
         FROM ledger_entries
        WHERE network_id = $1 AND account_type = 'publisher' AND status = 'approved'
          ${opts.publisherIds ? 'AND account_id = ANY($2)' : ''}
        GROUP BY account_id
       HAVING SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END) > 0`,
      opts.publisherIds ? [networkId, opts.publisherIds] : [networkId],
    );

    const lines: { publisherId: string; amount: string }[] = [];
    for (const b of balances.rows) {
      const payoutId = randomUUID();
      await client.query(
        `INSERT INTO payouts (id, network_id, batch_id, publisher_id, amount, currency, fx_rate, status)
         VALUES ($1,$2,$3,$4,$5,$6,1,'paid')`,
        [payoutId, networkId, batch.id, b.account_id, b.bal, currency],
      );
      await insertEntry(client, {
        networkId, accountType: 'publisher', accountId: b.account_id,
        entryType: 'payout', direction: 'debit', amount: b.bal, currency,
        idempotencyKey: `payout:${payoutId}`,
        metadata: { batch_id: batch.id, payout_id: payoutId },
      });
      lines.push({ publisherId: b.account_id, amount: b.bal });
    }

    const total = (await client.query<{ t: string }>(
      `UPDATE payout_batches SET total_amount = COALESCE((SELECT SUM(amount) FROM payouts WHERE batch_id = $1), 0)
       WHERE id = $1 RETURNING total_amount AS t`,
      [batch.id],
    )).rows[0]!.t;

    await client.query('COMMIT');
    return { batchId: batch.id, currency, total, lines };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

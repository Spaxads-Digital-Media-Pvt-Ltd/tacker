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
 * Balance = SUM(credit) − SUM(debit) over an account (filtered by status) AND currency — amounts in
 * different currencies are never summed together (there is no FX conversion anywhere in the ledger).
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query } from '../db/pool.js';
import { validationFailed } from '../http/errors.js';
import { CURRENCY_RE, absMoney, addMoney, moneySign, subMoney } from '../money.js';

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

interface ConversionNet { account_type: AccountType; account_id: string; currency: string; net: string }

/** Current net (credit − debit) per account for one conversion, across every entry type. */
async function conversionNets(client: PoolClient, networkId: string, conversionId: string): Promise<ConversionNet[]> {
  const { rows } = await client.query<ConversionNet>(
    `SELECT account_type, account_id, currency,
            SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::numeric(14,4)::text AS net
       FROM ledger_entries
      WHERE network_id = $1 AND conversion_id = $2 AND status = 'approved'
      GROUP BY account_type, account_id, currency`,
    [networkId, conversionId],
  );
  return rows;
}

/**
 * Reverse a conversion's ledger effect (spec §8): write offsetting entries — do NOT delete the
 * originals. Offsets the NET per account (earning/billing plus any adjustments), so the result is
 * exactly zero. Idempotent per account. Pass `client` to join the caller's transaction.
 */
export async function reverseConversionLedger(networkId: string, conversionId: string, reason: string, client?: PoolClient): Promise<void> {
  const run = async (c: PoolClient) => {
    for (const n of await conversionNets(c, networkId, conversionId)) {
      const sign = moneySign(n.net);
      if (sign === 0) continue;
      await insertEntry(c, {
        networkId, accountType: n.account_type, accountId: n.account_id, conversionId,
        entryType: 'reversal',
        direction: sign > 0 ? 'debit' : 'credit', // opposite of the net to bring it to zero
        amount: absMoney(n.net), currency: n.currency,
        // Per currency: a conversion whose nets span two currencies gets one offset per currency
        // (a per-account-type key silently dropped the second). Safe for existing data: a re-run
        // computes the nets first, and an already-reversed net is zero → nothing is written.
        idempotencyKey: `conv-reversal:${n.account_type}:${conversionId}:${n.currency}`,
        metadata: { conversion_id: conversionId, reason },
      });
    }
  };
  if (client) return run(client);
  const own = await pool.connect();
  try {
    await own.query('BEGIN');
    await run(own);
    await own.query('COMMIT');
  } catch (err) {
    await own.query('ROLLBACK');
    throw err;
  } finally {
    own.release();
  }
}

/**
 * Bring an APPROVED conversion's ledger in line with its (changed) payout / revenue by appending
 * `adjustment` entries for the difference — originals are never edited. Target nets: publisher
 * +payout (credit), advertiser −revenue (debit). Runs in the caller's transaction.
 */
export async function rebalanceConversionLedger(
  client: PoolClient,
  args: {
    networkId: string; conversionId: string;
    publisherId: string | null; advertiserId: string | null;
    payout: string | null; revenue: string | null; currency: string; reason: string;
  },
): Promise<void> {
  const nets = await conversionNets(client, args.networkId, args.conversionId);
  const targets: [AccountType, string | null, string][] = [
    ['publisher', args.publisherId, args.payout ?? '0'],
    ['advertiser', args.advertiserId, args.revenue ? subMoney('0', args.revenue) : '0'],
  ];
  // Currency guard FIRST (refusal writes nothing): the adjustment is booked in args.currency, so only
  // that currency's net may be compared with the target. A non-zero net in another currency can't be
  // offset without FX — refuse instead of netting across currencies.
  const foreign = [...new Set(nets
    .filter((n) => targets.some(([t, id]) => id != null && n.account_type === t && n.account_id === id))
    .filter((n) => n.currency !== args.currency && moneySign(n.net) !== 0)
    .map((n) => n.currency))].sort();
  if (foreign.length) {
    throw validationFailed(
      `Ledger entries for this conversion are in ${foreign.join(', ')}; it cannot be rebalanced in ${args.currency} without FX. Reverse and re-record it instead.`,
      { conversionId: args.conversionId, ledgerCurrencies: foreign, currency: args.currency },
    );
  }
  for (const [accountType, accountId, target] of targets) {
    if (!accountId) continue;
    const current = nets.find((n) =>
      n.account_type === accountType && n.account_id === accountId && n.currency === args.currency)?.net ?? '0';
    const delta = subMoney(target, current);
    const sign = moneySign(delta);
    if (sign === 0) continue;
    await insertEntry(client, {
      networkId: args.networkId, accountType, accountId, conversionId: args.conversionId,
      entryType: 'adjustment', direction: sign > 0 ? 'credit' : 'debit',
      amount: absMoney(delta), currency: args.currency,
      idempotencyKey: `conv-adjust:${accountType}:${args.conversionId}:${randomUUID()}`,
      metadata: { conversion_id: args.conversionId, reason: args.reason, from: current, to: target },
    });
  }
}

export interface CurrencyBalance { currency: string; balance: string }

/**
 * Balance per currency = SUM(credit) − SUM(debit) for an account, filtered by status, grouped by
 * currency (sorted by currency). numeric(14,4) strings. Currencies are NEVER summed together.
 */
export async function accountBalances(
  networkId: string, accountType: AccountType, accountId: string, status: Status = 'approved',
): Promise<CurrencyBalance[]> {
  const { rows } = await query<CurrencyBalance>(
    `SELECT currency,
            SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::numeric(14,4)::text AS balance
       FROM ledger_entries
      WHERE network_id = $1 AND account_type = $2 AND account_id = $3 AND status = $4
      GROUP BY currency
      ORDER BY currency`,
    [networkId, accountType, accountId, status],
  );
  return rows;
}

/**
 * Single-currency balance (no entries → '0.0000'). THROWS when the account's entries span several
 * currencies — a cross-currency sum is never returned. User-facing callers use balanceSummary.
 */
export async function accountBalance(
  networkId: string, accountType: AccountType, accountId: string, status: Status = 'approved',
): Promise<string> {
  const rows = await accountBalances(networkId, accountType, accountId, status);
  if (rows.length > 1) {
    throw new Error(`accountBalance: entries are in several currencies (${rows.map((r) => r.currency).join(', ')}) — use accountBalances`);
  }
  return rows[0]?.balance ?? '0.0000';
}

/** The network's default currency ('USD' when missing or not a 3-letter code). */
export async function networkDefaultCurrency(networkId: string, client?: PoolClient): Promise<string> {
  const sql = `SELECT default_currency FROM networks WHERE id = $1`;
  const rows = client
    ? (await client.query<{ default_currency: string | null }>(sql, [networkId])).rows
    : (await query<{ default_currency: string | null }>(sql, [networkId])).rows;
  const cur = rows[0]?.default_currency?.trim().toUpperCase();
  return cur && CURRENCY_RE.test(cur) ? cur : 'USD';
}

/**
 * Collapse per-currency balances into the additive single-value contract: ≤1 currency → that
 * balance + currency ('0.0000' + `defaultCurrency` when there are no entries); several currencies →
 * balance null + currency null (the caller reads the per-currency list instead).
 */
export function collapseBalances(
  balances: CurrencyBalance[], defaultCurrency: string,
): { balance: string | null; currency: string | null } {
  if (balances.length === 0) return { balance: '0.0000', currency: defaultCurrency };
  if (balances.length === 1) return { balance: balances[0]!.balance, currency: balances[0]!.currency };
  return { balance: null, currency: null };
}

export interface BalanceSummary { balance: string | null; currency: string | null; balances: CurrencyBalance[] }

/** accountBalances + collapseBalances (the network default is looked up only when there are no entries). */
export async function balanceSummary(
  networkId: string, accountType: AccountType, accountId: string, status: Status = 'approved',
): Promise<BalanceSummary> {
  const balances = await accountBalances(networkId, accountType, accountId, status);
  const dflt = balances.length === 0 ? await networkDefaultCurrency(networkId) : '';
  return { ...collapseBalances(balances, dflt), balances };
}

export interface PayoutRunResult {
  batchId: string;
  /** The batch's ONE currency — every line and ledger debit of this run is in it. */
  currency: string;
  total: string;
  lines: { publisherId: string; amount: string }[];
  /** Positive balances whose currency isn't a valid 3-letter code (e.g. '' legacy rows) — never paid. */
  skipped: { publisherId: string; currency: string; amount: string }[];
  /** Positive balances in OTHER valid currencies, left untouched — run one payout per currency. */
  otherCurrencies: { currency: string; publishers: number; total: string }[];
}

/**
 * Create a payout run (spec §8) for ONE currency: each eligible publisher's positive approved
 * balance IN THAT CURRENCY becomes a payout line + a ledger 'payout' debit (drawing that currency's
 * balance to zero), with the batch, all in ONE transaction. No FX: fx_rate stays 1 and nothing is
 * converted; positive balances in other currencies are untouched and listed in `otherCurrencies`.
 *
 *  - `opts.currency` given → pay only that currency.
 *  - omitted → the single currency among the eligible balances; none → the network's default
 *    currency (an empty run, as before); several → 422 validation_failed and nothing is written.
 *
 * A per-network transaction-scoped advisory lock serialises runs and balances are read after it, so
 * two concurrent runs can never both pay the same balance (the second one sees zero). Idempotent per
 * payout line via `payout:{payoutId}`.
 */
export async function createPayoutRun(
  networkId: string,
  opts: { publisherIds?: string[]; createdBy?: string; note?: string; currency?: string } = {},
): Promise<PayoutRunResult> {
  if (opts.currency !== undefined && !CURRENCY_RE.test(opts.currency)) {
    throw validationFailed('currency must be a 3-letter upper-case code (e.g. USD)', { currency: opts.currency });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One payout run per network at a time (released automatically at COMMIT / ROLLBACK).
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('payout-run:' || $1::text, 0))`, [networkId]);

    // Positive approved balance per (publisher, currency), optionally restricted to a set — read
    // AFTER the lock, so a run that committed just before us is already reflected (balance zero).
    const balances = (await client.query<{ account_id: string; currency: string; bal: string }>(
      `SELECT account_id, currency,
              SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END)::numeric(14,4)::text AS bal
         FROM ledger_entries
        WHERE network_id = $1 AND account_type = 'publisher' AND status = 'approved'
          ${opts.publisherIds ? 'AND account_id = ANY($2::uuid[])' : ''}
        GROUP BY account_id, currency
       HAVING SUM(CASE direction WHEN 'credit' THEN amount ELSE -amount END) > 0
        ORDER BY currency, account_id`,
      opts.publisherIds ? [networkId, opts.publisherIds] : [networkId],
    )).rows;

    const skipped = balances.filter((b) => !CURRENCY_RE.test(b.currency))
      .map((b) => ({ publisherId: b.account_id, currency: b.currency, amount: b.bal }));
    const eligible = balances.filter((b) => CURRENCY_RE.test(b.currency));
    const present = [...new Set(eligible.map((b) => b.currency))].sort();

    let currency: string;
    if (opts.currency) currency = opts.currency;
    else if (present.length === 1) currency = present[0]!;
    else if (present.length === 0) currency = await networkDefaultCurrency(networkId, client);
    else {
      // Nothing has been written yet; the catch below rolls back (and releases the lock).
      throw validationFailed(
        `Payable balances are in several currencies (${present.join(', ')}). Run one payout per currency — pass "currency".`,
        { currencies: present },
      );
    }

    const others = new Map<string, { publishers: number; total: string }>();
    for (const b of eligible) {
      if (b.currency === currency) continue;
      const o = others.get(b.currency) ?? { publishers: 0, total: '0.0000' };
      others.set(b.currency, { publishers: o.publishers + 1, total: addMoney(o.total, b.bal) });
    }
    const otherCurrencies = [...others].map(([c, o]) => ({ currency: c, publishers: o.publishers, total: o.total }));

    const batch = (await client.query<{ id: string }>(
      `INSERT INTO payout_batches (network_id, status, currency, fx_rate, note, created_by)
       VALUES ($1, 'paid', $2, 1, $3, $4) RETURNING id`,
      [networkId, currency, opts.note ?? null, opts.createdBy ?? null],
    )).rows[0]!;

    const lines: { publisherId: string; amount: string }[] = [];
    for (const b of eligible) {
      if (b.currency !== currency) continue;
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

    // Batch total = sum of its own lines (all in the batch currency).
    const total = (await client.query<{ t: string }>(
      `UPDATE payout_batches
          SET total_amount = COALESCE((SELECT SUM(amount) FROM payouts WHERE network_id = $2 AND batch_id = $1), 0)
        WHERE id = $1 AND network_id = $2 RETURNING total_amount AS t`,
      [batch.id, networkId],
    )).rows[0]!.t;

    await client.query('COMMIT');
    return { batchId: batch.id, currency, total, lines, skipped, otherCurrencies };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

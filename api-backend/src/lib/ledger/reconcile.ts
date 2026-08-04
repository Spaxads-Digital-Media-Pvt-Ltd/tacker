/**
 * Ledger reconciliation (spec §8) — flags any drift between recorded payouts and the ledger's
 * payout debits, per publisher. A clean run returns []. Meant to run scheduled (BullMQ repeatable
 * or `npm run reconcile`); discrepancies feed the alerts table in Phase 6.
 */
import { query } from '../db/pool.js';

export interface Drift {
  networkId: string;
  publisherId: string;
  ledgerPayout: string; // SUM of ledger 'payout' debits
  payoutsTable: string; // SUM of payouts.amount
  drift: string;
}

export async function reconcileLedger(): Promise<Drift[]> {
  const { rows } = await query<{
    network_id: string; publisher_id: string; ledger_payout: string; paid: string; drift: string;
  }>(
    `SELECT COALESCE(l.network_id, p.network_id)   AS network_id,
            COALESCE(l.publisher_id, p.publisher_id) AS publisher_id,
            COALESCE(l.ledger_payout, 0)::numeric(14,4) AS ledger_payout,
            COALESCE(p.paid, 0)::numeric(14,4)          AS paid,
            (COALESCE(l.ledger_payout, 0) - COALESCE(p.paid, 0))::numeric(14,4) AS drift
       FROM (SELECT network_id, account_id AS publisher_id, SUM(amount) AS ledger_payout
               FROM ledger_entries
              WHERE entry_type = 'payout' AND account_type = 'publisher'
              GROUP BY network_id, account_id) l
       FULL JOIN (SELECT network_id, publisher_id, SUM(amount) AS paid
                    FROM payouts GROUP BY network_id, publisher_id) p
         ON l.network_id = p.network_id AND l.publisher_id = p.publisher_id
      WHERE COALESCE(l.ledger_payout, 0) <> COALESCE(p.paid, 0)`,
  );
  return rows.map((r) => ({
    networkId: r.network_id, publisherId: r.publisher_id,
    ledgerPayout: r.ledger_payout, payoutsTable: r.paid, drift: r.drift,
  }));
}

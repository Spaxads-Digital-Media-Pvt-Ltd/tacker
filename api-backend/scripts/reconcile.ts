/** Run ledger reconciliation once (spec §8). Exit non-zero if drift is found. */
import { reconcileLedger } from '../src/lib/ledger/reconcile.js';
import { closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

reconcileLedger()
  .then(async (drift) => {
    if (drift.length === 0) {
      logger.info('ledger reconciled — no drift');
    } else {
      logger.error({ drift }, `ledger drift detected in ${drift.length} account(s)`);
    }
    await closeDb();
    process.exit(drift.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    logger.error({ err }, 'reconciliation failed');
    void closeDb().finally(() => process.exit(2));
  });

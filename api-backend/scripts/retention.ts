/** Run the retention prune once (spec §7/§11). Windows come from env: npm run retention */
import { runRetention } from '../src/lib/retention/retention.js';
import { closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

runRetention()
  .then(async (result) => {
    logger.info(result, 'retention done');
    await closeDb();
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'retention failed');
    void closeDb().finally(() => process.exit(1));
  });

/** Run the fraud scan once (spec §10). Optionally pass a network id: npm run fraud-scan -- <networkId> */
import { runFraudScan } from '../src/lib/fraud/scan.js';
import { closeDb } from '../src/lib/db/pool.js';
import { logger } from '../src/lib/logger.js';

runFraudScan(process.argv[2])
  .then(async (result) => {
    logger.info(result, 'fraud scan done');
    await closeDb();
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'fraud scan failed');
    void closeDb().finally(() => process.exit(1));
  });

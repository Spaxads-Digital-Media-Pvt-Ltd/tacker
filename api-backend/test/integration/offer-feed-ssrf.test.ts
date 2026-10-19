/**
 * The offer-feed sync reports a blocked destination instead of fetching an internal URL — on a real
 * Postgres (INTEGRATION_DB=1, as in CI; NODE_ENV=test, so private targets are refused) — audit F-06.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { syncOfferFeed } from '../../src/lib/integrations/offer-feed-sync.js';
import { loadIntegrations, saveIntegrations } from '../../src/lib/integrations/settings.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('offer-feed sync goes through the SSRF guard (live DB)', () => {
  let fx: Fixture;
  const feedOffers = async () => Number((await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM offers WHERE network_id = $1 AND metadata->>'feedSource' = 'offer_feed'`, [fx.networkA])).rows[0]!.n);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`feed-${randomUUID().slice(0, 8)}`);
  });

  it('an internal feed URL is reported as blocked, saved as the last sync error, and creates nothing', async () => {
    await saveIntegrations(fx.networkA, { offerFeedUrl: 'http://127.0.0.1:4005/health', offerFeedAdvertiserId: fx.advA });
    const result = await syncOfferFeed(fx.networkA);
    expect(result).toMatchObject({ pulled: 0, created: 0, updated: 0 });
    expect(result.error).toMatch(/^blocked_destination: private_address/);
    expect((await loadIntegrations(fx.networkA)).offerFeedLastSyncError).toBe(result.error);
    expect(await feedOffers()).toBe(0);
  });

  it('the dashboard "Sync now" returns the same blocked error', async () => {
    await saveIntegrations(fx.networkA, { offerFeedUrl: 'http://169.254.169.254/latest/meta-data/', offerFeedAdvertiserId: fx.advA });
    const res = await request(buildDashboardApp()).post('/api/settings/integrations/offer-feed/sync')
      .set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA })));
    expect(res.status).toBe(200);
    expect(res.body.data.error).toMatch(/^blocked_destination: private_address/);
    expect(await feedOffers()).toBe(0);
  });

  it('the demo feed still syncs', async () => {
    await saveIntegrations(fx.networkA, { offerFeedUrl: 'demo://offer-feed', offerFeedAdvertiserId: fx.advA });
    expect(await syncOfferFeed(fx.networkA)).toEqual({ pulled: 3, created: 3, updated: 0 });
    expect((await loadIntegrations(fx.networkA)).offerFeedLastSyncError).toBeNull();
  });
});

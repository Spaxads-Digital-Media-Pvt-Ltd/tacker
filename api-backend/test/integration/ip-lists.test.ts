/**
 * Control Center › Security IP lists are enforced — on a real Postgres + Redis (INTEGRATION_DB=1,
 * as in CI) — audit F-16.
 *
 * The network IP blacklist (IPs, CIDRs, ranges; IPv4 + IPv6) diverts /click from a listed client;
 * the API IP whitelist restricts the network's own API keys to the listed addresses. Both use the
 * real client IP (X-Forwarded-For from a trusted proxy only) and apply on the next request after a
 * Control Center write.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { hashKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('IP blacklist + API IP whitelist enforcement (live DB + Redis)', () => {
  let dash: Express;
  let api: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let admin: { Authorization: string };
  let networkKey: string;
  let advertiserKey: string;

  const clickFrom = (ip: string) =>
    track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host, 'x-forwarded-for': ip } });
  const blacklist = (ranges: { from: string; to?: string }[]) =>
    request(dash).put('/api/control-center/ip-blacklist').set(admin).send({ ranges });
  const apiFrom = (key: string, ip: string, path = '/api/v1/network/offers') =>
    request(api).get(path).set('x-api-key', key).set('x-forwarded-for', ip);
  const mintKey = async (audience: 'network' | 'advertiser', ownerId: string) => {
    const raw = `tk_${audience}_${randomUUID().replace(/-/g, '')}`;
    await query(
      `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, name, scopes, status)
       VALUES ($1, $2, $3, $4, $5, 'F-16 test', $6, 'active')`,
      [fx.networkA, audience, ownerId, raw.slice(0, 12), hashKey(raw), AUDIENCE_SCOPES[audience]]);
    return raw;
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`iplists-${randomUUID().slice(0, 8)}`);
    host = `iplists-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
    api = buildPublicApiApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
    networkKey = await mintKey('network', randomUUID());
    advertiserKey = await mintKey('advertiser', fx.advA);
  });

  describe('IP blacklist at /click', () => {
    it('diverts listed IPs, CIDRs, ranges and IPv6 — and only those', async () => {
      expect((await clickFrom('203.0.113.10')).statusCode).toBe(302); // nothing listed yet (and now cached)
      const res = await blacklist([
        { from: '203.0.113.10' }, { from: '198.51.100.0/24' }, { from: '192.0.2.10', to: '192.0.2.20' }, { from: '2001:db8::/32' },
      ]);
      expect(res.status).toBe(200);
      expect((await clickFrom('203.0.113.10')).statusCode).toBe(204); // applies on the very next click
      expect((await clickFrom('198.51.100.77')).statusCode).toBe(204);
      expect((await clickFrom('192.0.2.15')).statusCode).toBe(204);
      expect((await clickFrom('2001:db8::1')).statusCode).toBe(204);
      expect((await clickFrom('192.0.2.21')).statusCode).toBe(302);
      expect((await clickFrom('203.0.113.11')).statusCode).toBe(302);
      expect((await clickFrom('2001:db9::1')).statusCode).toBe(302);
    });

    it('an untrusted peer cannot dodge it by spoofing X-Forwarded-For (the real client IP is used)', async () => {
      await blacklist([{ from: '203.0.113.99' }]);
      const r = await track.inject({
        method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`,
        headers: { host, 'x-forwarded-for': '8.8.8.8' }, remoteAddress: '203.0.113.99',
      });
      expect(r.statusCode).toBe(204);
    });

    it('rejects malformed entries; clearing the list stops blocking', async () => {
      expect((await blacklist([{ from: 'not-an-ip' }])).status).toBe(422);
      expect((await blacklist([{ from: '10.0.0.1', to: '2001:db8::1' }])).status).toBe(422);
      await blacklist([{ from: '203.0.113.10' }]);
      expect((await clickFrom('203.0.113.10')).statusCode).toBe(204);
      expect((await blacklist([])).status).toBe(200);
      expect((await clickFrom('203.0.113.10')).statusCode).toBe(302);
    });
  });

  describe('API IP whitelist on the Public API', () => {
    it('no whitelist → any IP; with one, the network key only works from listed IPs/CIDRs', async () => {
      expect((await apiFrom(networkKey, '198.51.100.5')).status).toBe(200);

      const add = await request(dash).post('/api/control-center/api-whitelist').set(admin).send({ ipAddress: '203.0.113.7' });
      expect(add.status).toBe(201);
      const denied = await apiFrom(networkKey, '203.0.113.8');
      expect(denied.status).toBe(403);
      expect(denied.body.error.message).toMatch(/whitelisted IP addresses/);
      expect((await apiFrom(networkKey, '203.0.113.7')).status).toBe(200);

      const cidr = await request(dash).post('/api/control-center/api-whitelist').set(admin).send({ ipAddress: '192.0.2.0/24' });
      expect((await apiFrom(networkKey, '192.0.2.200')).status).toBe(200);

      // Partner/advertiser keys are called from the partners' own servers — not restricted by it.
      expect((await apiFrom(advertiserKey, '8.8.8.8', '/api/v1/advertiser/offers')).status).toBe(200);

      for (const id of [add.body.data.id, cidr.body.data.id]) {
        expect((await request(dash).delete(`/api/control-center/api-whitelist/${id}`).set(admin)).status).toBe(200);
      }
      expect((await apiFrom(networkKey, '203.0.113.8')).status).toBe(200); // list gone → open again
    });

    it('rejects a whitelist entry that is not an IP or CIDR', async () => {
      expect((await request(dash).post('/api/control-center/api-whitelist').set(admin).send({ ipAddress: 'office' })).status).toBe(422);
    });
  });
});

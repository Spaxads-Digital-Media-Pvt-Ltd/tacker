/**
 * The offer's postback security code is only for roles that manage integrations (O5) — live DB.
 * Admin / manager see it; finance and read-only get `securityCode: null` with `securityCodeSet` and
 * `securityCodeHidden: true`, on the detail, both list shapes and write responses; they can't
 * regenerate it either.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('offer security codes are hidden from roles that do not manage integrations (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  let code: string;
  const as = (role: string) => bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`secret-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    const regen = await request(dash).post(`/api/offers/${fx.offerA}/security-code/regenerate`).set(as('admin'));
    expect(regen.status).toBe(200);
    code = regen.body.data.securityCode;
  });

  it('admins and managers see the code', async () => {
    for (const role of ['admin', 'manager']) {
      const res = await request(dash).get(`/api/offers/${fx.offerA}`).set(as(role));
      expect(res.body.data, role).toMatchObject({ securityCode: code, securityCodeSet: true, securityCodeHidden: false });
    }
  });

  it('finance and read-only get it masked — detail, both lists and write responses', async () => {
    for (const role of ['finance', 'read_only']) {
      const detail = await request(dash).get(`/api/offers/${fx.offerA}`).set(as(role));
      expect(detail.body.data, role).toMatchObject({ securityCode: null, securityCodeSet: true, securityCodeHidden: true });
      const list = await request(dash).get('/api/offers').set(as(role));
      const row = (list.body.data as { id: string; securityCode: string | null }[]).find((o) => o.id === fx.offerA);
      expect(row?.securityCode, role).toBeNull();
      const paged = await request(dash).get('/api/offers?paged=1&page=1&pageSize=50').set(as(role));
      const prow = (paged.body.data.rows as { id: string; securityCode: string | null; securityCodeHidden: boolean }[]).find((o) => o.id === fx.offerA);
      expect(prow, role).toMatchObject({ securityCode: null, securityCodeHidden: true });
      expect(JSON.stringify([detail.body, list.body, paged.body])).not.toContain(code);
      expect((await request(dash).post(`/api/offers/${fx.offerA}/security-code/regenerate`).set(as(role))).status).toBe(403);
    }
  });

  it('an offer without its own code says so to every role', async () => {
    await request(dash).delete(`/api/offers/${fx.offerA}/security-code`).set(as('manager'));
    const res = await request(dash).get(`/api/offers/${fx.offerA}`).set(as('read_only'));
    expect(res.body.data).toMatchObject({ securityCode: null, securityCodeSet: false, securityCodeHidden: true });
  });
});

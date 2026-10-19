/**
 * "Created By" shows who, by name (N2) — live DB. Rows stamp the creating LOGIN's id (the token's
 * `sub` = users.auth_user_id); the lists look up the team member behind it: offer scheduled actions
 * (the offer's tab and Automation) and conversion imports — which joined the users table's own id, so
 * it never found anyone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('Created By = the team member, by name (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  const member = async (name: string | null, role = 'manager') => {
    const userId = randomUUID();
    const email = `member-${userId.slice(0, 6)}@example.com`;
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
      [fx.networkA, userId, email, name, role]);
    return { userId, email, headers: bearer(operatorToken({ userId, networkId: fx.networkA, role })) };
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`createdby-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
  });

  it("offer scheduled actions: the offer's tab and Automation name the creator", async () => {
    const priya = await member('Priya Manager');
    const made = await request(dash).post(`/api/offers/${fx.offerA}/scheduled-actions`).set(priya.headers).send({ actionType: 'pause', status: 'cancelled' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ createdBy: priya.userId, createdByName: 'Priya Manager' });
    const tab = (await request(dash).get(`/api/offers/${fx.offerA}/scheduled-actions`).set(priya.headers)).body.data as Record<string, unknown>[];
    expect(tab.find((a) => a['id'] === made.body.data.id)).toMatchObject({ createdByName: 'Priya Manager' });
    const automation = (await request(dash).get('/api/automation/scheduled-actions').set(priya.headers)).body.data as Record<string, unknown>[];
    expect(automation.find((a) => a['id'] === made.body.data.id)).toMatchObject({ createdBy: priya.userId, createdByName: 'Priya Manager' });

    // Through Automation, by a member with no name → their email; an edit keeps the creator.
    const noName = await member(null);
    const viaAutomation = await request(dash).post('/api/automation/scheduled-actions').set(noName.headers).send({ offerId: fx.offerA, actionType: 'pause', status: 'cancelled' });
    expect(viaAutomation.status).toBe(201);
    expect(viaAutomation.body.data).toMatchObject({ createdByName: noName.email });
    const edited = await request(dash).patch(`/api/automation/scheduled-actions/${viaAutomation.body.data.id}`).set(priya.headers).send({ internalNotes: 'moved' });
    expect(edited.body.data).toMatchObject({ createdBy: noName.userId, createdByName: noName.email });

    // A login with no team member behind it: the id is kept, there's no name (the SPA says "Unknown user").
    const ghost = await request(dash).post(`/api/offers/${fx.offerA}/scheduled-actions`)
      .set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }))).send({ actionType: 'pause', status: 'cancelled' });
    expect(ghost.body.data.createdBy).toBeTruthy();
    expect(ghost.body.data.createdByName).toBeNull();
  });

  it('conversion imports: Created By is the importer', async () => {
    const importer = await member('Imran Importer');
    const job = await request(dash).post('/api/conversion-imports').set(importer.headers)
      .send({ type: 'create', rows: [{ offerRef: '999999999', transactionId: `T-${randomUUID().slice(0, 6)}`, payout: '1', revenue: '2', status: 'approved' }] });
    expect(job.status).toBe(201);
    const list = (await request(dash).get('/api/conversion-imports').set(importer.headers)).body.data as Record<string, unknown>[];
    expect(list.find((j) => j['id'] === job.body.data.id)).toMatchObject({ created_by_name: 'Imran Importer', created_by_email: importer.email });
  });
});

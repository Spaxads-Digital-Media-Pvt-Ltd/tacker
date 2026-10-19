/**
 * Read-only (and finance) users can't write through the routes that lacked a role guard — on a real
 * Postgres (INTEGRATION_DB=1, as in CI) — audit F-13. Admin/manager writes still work end to end.
 * The Anthropic call behind /api/ai/chat is mocked (it would spend the network's budget).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const ai = vi.hoisted(() => ({ runChat: vi.fn(async () => ({ conversationId: crypto.randomUUID(), reply: 'ok', toolCalls: [] })) }));
vi.mock('../../src/lib/ai/service.js', () => ({ runChat: ai.runChat, isAiConfigured: () => true }));

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('role guards on investigator / AI chat / alerts writes (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  const as = (role: string) => bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));
  const investigation = { startDate: '2026-10-01', endDate: '2026-10-02', targetType: 'click_id', targetValue: 'abc123' };
  const investigations = async () => Number((await query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM investigations WHERE network_id = $1', [fx.networkA])).rows[0]!.n);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`rbac-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
  });

  it('investigator: read_only/finance can create, refresh or delete nothing; admin and manager can', async () => {
    for (const role of ['read_only', 'finance']) {
      expect((await request(dash).post('/api/investigator').set(as(role)).send(investigation)).status).toBe(403);
    }
    expect(await investigations()).toBe(0);

    const created = await request(dash).post('/api/investigator').set(as('admin')).send(investigation);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(await investigations()).toBe(1);

    expect((await request(dash).post(`/api/investigator/${id}/refresh`).set(as('read_only'))).status).toBe(403);
    expect((await request(dash).post(`/api/investigator/${id}/refresh`).set(as('manager'))).status).toBe(200);

    expect((await request(dash).delete(`/api/investigator/${id}`).set(as('read_only'))).status).toBe(403);
    expect(await investigations()).toBe(1);
    expect((await request(dash).delete(`/api/investigator/${id}`).set(as('manager'))).status).toBe(200);
    expect(await investigations()).toBe(0);
  });

  it('AI chat: read_only/finance → 403 without spending anything; admin and manager chat', async () => {
    for (const role of ['read_only', 'finance']) {
      expect((await request(dash).post('/api/ai/chat').set(as(role)).send({ message: 'clicks today?' })).status).toBe(403);
    }
    expect(ai.runChat).not.toHaveBeenCalled();
    for (const role of ['admin', 'manager']) {
      expect((await request(dash).post('/api/ai/chat').set(as(role)).send({ message: 'clicks today?' })).status).toBe(200);
    }
    expect(ai.runChat).toHaveBeenCalledTimes(2);
  });

  it('alerts: read_only/finance cannot change an alert; admin and manager can', async () => {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO alerts (network_id, type, title) VALUES ($1, 'fraud_spike', 'F-13 test alert') RETURNING id`, [fx.networkA]);
    const id = rows[0]!.id;
    const status = async () => (await query<{ status: string }>('SELECT status FROM alerts WHERE id = $1', [id])).rows[0]!.status;

    for (const role of ['read_only', 'finance']) {
      expect((await request(dash).patch(`/api/alerts/${id}`).set(as(role)).send({ status: 'resolved' })).status).toBe(403);
    }
    expect(await status()).toBe('open');
    expect((await request(dash).patch(`/api/alerts/${id}`).set(as('manager')).send({ status: 'acknowledged' })).status).toBe(200);
    expect(await status()).toBe('acknowledged');
    expect((await request(dash).patch(`/api/alerts/${id}`).set(as('admin')).send({ status: 'resolved' })).status).toBe(200);
    expect(await status()).toBe('resolved');
  });

  it('reads stay open to read_only', async () => {
    for (const path of ['/api/investigator', '/api/alerts', '/api/ai/conversations']) {
      expect((await request(dash).get(path).set(as('read_only'))).status).toBe(200);
    }
  });
});

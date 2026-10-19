/**
 * Write routes that lacked a role guard (audit F-13) — no DB needed: the guard runs before any
 * query, so a refused call must not reach the database (or the Anthropic budget) at all.
 *   investigator: POST /, POST /:id/refresh, DELETE /:id · ai: POST /chat · alerts: PATCH /:id
 * read_only and finance → 403; admin and manager get through to the handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { operatorToken, bearer } from '../helpers/tokens.js';

const db = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock('../../src/lib/db/pool.js', () => ({
  query: async (sql: string) => {
    // The request gate's own lookups (dashboardAuth: the network's state, the team member's row; requireFeature:
    // the platform's feature flags — a read, none here); every other statement is recorded.
    if (/FROM networks WHERE id = \$1/.test(sql)) return { rows: [{ status: 'active' }], rowCount: 1 };
    if (/FROM users WHERE network_id = \$1 AND auth_user_id = \$2/.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM platform_feature_flags/.test(sql)) return { rows: [], rowCount: 0 };
    db.queries.push(sql);
    return { rows: [], rowCount: 0 };
  },
  pool: { connect: async () => { throw new Error('no pool in this test'); } },
}));
const ai = vi.hoisted(() => ({ runChat: vi.fn(async () => ({ conversationId: 'c1', reply: 'hi', toolCalls: [] })) }));
vi.mock('../../src/lib/ai/service.js', () => ({ runChat: ai.runChat, isAiConfigured: () => true }));

const { buildDashboardApp } = await import('../../src/surfaces/dashboard/app.js');
const app = buildDashboardApp();
const NET = randomUUID();
const ID = randomUUID();
const as = (role: string) => bearer(operatorToken({ userId: randomUUID(), networkId: NET, role }));

const routes: [string, (auth: Record<string, string>) => request.Test][] = [
  ['POST /api/investigator', (a) => request(app).post('/api/investigator').set(a)
    .send({ startDate: '2026-10-01', endDate: '2026-10-02', targetType: 'click_id', targetValue: 'abc' })],
  ['POST /api/investigator/:id/refresh', (a) => request(app).post(`/api/investigator/${ID}/refresh`).set(a)],
  ['DELETE /api/investigator/:id', (a) => request(app).delete(`/api/investigator/${ID}`).set(a)],
  ['POST /api/ai/chat', (a) => request(app).post('/api/ai/chat').set(a).send({ message: 'how are clicks today?' })],
  ['PATCH /api/alerts/:id', (a) => request(app).patch(`/api/alerts/${ID}`).set(a).send({ status: 'resolved' })],
];

beforeEach(() => {
  db.queries.length = 0;
  ai.runChat.mockClear();
});

describe.each(['read_only', 'finance'])('%s', (role) => {
  it.each(routes)('%s → 403, and nothing is written or spent', async (_name, call) => {
    const res = await call(as(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect(db.queries).toEqual([]);
    expect(ai.runChat).not.toHaveBeenCalled();
  });
});

describe.each(['admin', 'manager'])('%s', (role) => {
  it.each(routes)('%s → passes the guard', async (_name, call) => {
    const res = await call(as(role));
    expect(res.status).not.toBe(403);
  });

  it('AI chat runs for them', async () => {
    const res = await request(app).post('/api/ai/chat').set(as(role)).send({ message: 'hello' });
    expect(res.status).toBe(200);
    expect(ai.runChat).toHaveBeenCalledTimes(1);
  });
});

/**
 * Per-network daily AI budget on /api/ai/chat — on a real Postgres + Redis (INTEGRATION_DB=1) with the
 * Anthropic SDK mocked (no real calls, nothing billed) — audit F-25·F-28 step 5.
 *
 * Each network gets AI_DAILY_CHAT_LIMIT chats and AI_DAILY_TOKEN_LIMIT tokens (input + output of every
 * model turn) per UTC day. Past either → 429 rate_limited with Retry-After until 00:00 UTC, and the
 * model isn't called. A refused chat isn't counted; other networks are unaffected.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const model = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.AI_DAILY_CHAT_LIMIT = '5';
  process.env.AI_DAILY_TOKEN_LIMIT = '3000';
  return { calls: 0, input: 1000, output: 200 };
});
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => {
        model.calls++;
        return { content: [{ type: 'text', text: 'All good.' }], stop_reason: 'end_turn', usage: { input_tokens: model.input, output_tokens: model.output } };
      },
    };
  },
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, seedFixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('AI daily budget per network (live DB + Redis, model mocked)', () => {
  let dash: Express;
  const adminOf = (networkId: string) => bearer(operatorToken({ userId: randomUUID(), networkId, role: 'admin' }));
  const chat = (auth: { Authorization: string }) => request(dash).post('/api/ai/chat').set(auth).send({ message: 'How many clicks today?' });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    dash = buildDashboardApp();
  });

  it('a network that spent its daily token budget gets 429 until 00:00 UTC (model not called); another network is unaffected', async () => {
    const fx = await seedFixture(`aiq-${randomUUID().slice(0, 8)}`);
    const admin = adminOf(fx.networkA);
    model.input = 1000; model.output = 200; // 1,200 tokens a chat
    for (let i = 0; i < 3; i++) expect((await chat(admin)).status).toBe(200); // 3,600 used — the third started at 2,400

    const before = model.calls;
    const refused = await chat(admin);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatchObject({ code: 'rate_limited', details: { limit: 3000 } });
    expect(refused.body.error.message).toMatch(/today's AI token budget \(3,000 per day\)/);
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    expect(model.calls).toBe(before);

    const status = await request(dash).get('/api/ai/status').set(admin);
    expect(status.body.data).toMatchObject({ configured: true, quota: { chats: { used: 3, limit: 5 }, tokens: { used: 3600, limit: 3000 } } });
    expect(Date.parse(status.body.data.quota.resetsAt)).toBe(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000);

    expect((await chat(adminOf(fx.networkB))).status).toBe(200);
  });

  it('the chat after the daily chat limit is refused, and a refused chat is not counted', async () => {
    const fx = await seedFixture(`aiq-${randomUUID().slice(0, 8)}`);
    const admin = adminOf(fx.networkA);
    model.input = 1; model.output = 1;
    for (let i = 0; i < 5; i++) expect((await chat(admin)).status).toBe(200);
    const refused = await chat(admin);
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toMatch(/today's AI chat limit \(5 per day\)/);
    expect((await chat(admin)).status).toBe(429);
    const status = await request(dash).get('/api/ai/status').set(admin);
    expect(status.body.data.quota.chats).toEqual({ used: 5, limit: 5 });
  });
});

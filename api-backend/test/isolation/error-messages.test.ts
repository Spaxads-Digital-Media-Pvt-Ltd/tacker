/**
 * Error messages a person can act on (no DB): a validation failure says what's wrong with which field
 * — not "Request body failed validation" — and an unexpected server error quotes the request's
 * reference (the X-Request-Id it was logged under), naming the cause outside production.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { createBaseApp, finalizeApp } from '../../src/lib/http/express-app.js';
import { validateBody, validateQuery, describeIssues } from '../../src/lib/http/validate.js';
import { passwordSchema } from '../../src/lib/auth/password-policy.js';

const appWith = (setup: (app: ReturnType<typeof createBaseApp>) => void) => {
  const app = createBaseApp('test', false);
  setup(app);
  finalizeApp(app);
  return app;
};

describe('validation failures name the problem', () => {
  const login = appWith((app) => app.post('/login', validateBody(z.object({ email: z.string().email(), password: passwordSchema })), (_req, res) => { res.json({ ok: true }); }));

  it('a too-short password: the policy\'s own sentence (it already names the field)', async () => {
    const res = await request(login).post('/login').send({ email: 'a@example.com', password: 'short-pw10' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'validation_failed', message: 'Password must be at least 12 characters.' });
    expect(res.body.error.details).toEqual({ password: ['Password must be at least 12 characters.'] }); // unchanged for programs
  });

  it('several problems: each with its field, in order', async () => {
    const res = await request(login).post('/login').send({ email: 'not-an-email' });
    expect(res.body.error.message).toBe('Email: Invalid email · Password: Required');
  });

  it('camelCase and nested fields read as words; list items are 1-based', () => {
    const s = z.object({ dailyConversionCap: z.number(), rows: z.array(z.object({ payout_value: z.string() })) });
    const r = s.safeParse({ dailyConversionCap: 'ten', rows: [{ payout_value: 'ok' }, { payout_value: 'ok' }, {}] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(describeIssues(r.error, 'x')).toBe('Daily conversion cap: Expected number, received string · Rows › #3 › Payout value: Required');
    }
  });

  it('an unknown key on a strict schema keeps zod\'s sentence; more than three problems are counted', () => {
    const strict = z.object({ a: z.string() }).strict().safeParse({ a: 'x', foo: 1 });
    if (!strict.success) expect(describeIssues(strict.error, 'x')).toBe("Unrecognized key(s) in object: 'foo'");
    const many = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() }).safeParse({});
    if (!many.success) expect(describeIssues(many.error, 'x')).toBe('A: Required · B: Required · C: Required (and 2 more)');
  });

  it('a query string too', async () => {
    const app = appWith((a) => a.get('/r', validateQuery(z.object({ limit: z.coerce.number().int().max(500) }).strict()), (_req, res) => { res.json({ ok: true }); }));
    const res = await request(app).get('/r?limit=9000');
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Limit: Number must be less than or equal to 500');
  });
});

describe('an unexpected server error', () => {
  const app = appWith((a) => a.get('/boom', () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); }));

  it('says so in plain words, names the cause outside production, and quotes the request\'s reference', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    const ref = res.headers['x-request-id'] as string;
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.error).toEqual({
      code: 'internal',
      message: `Something went wrong on our side (connect ECONNREFUSED 127.0.0.1:5432). If it keeps happening, quote reference ${ref}.`,
      details: { reference: ref },
    });
  });

  it("keeps a proxy's request id as the reference; ignores one that doesn't look like an id", async () => {
    const kept = await request(app).get('/boom').set('x-request-id', 'edge-1234abcd');
    expect(kept.headers['x-request-id']).toBe('edge-1234abcd');
    expect(kept.body.error.details).toEqual({ reference: 'edge-1234abcd' });
    const odd = await request(app).get('/boom').set('x-request-id', '<script>');
    expect(odd.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

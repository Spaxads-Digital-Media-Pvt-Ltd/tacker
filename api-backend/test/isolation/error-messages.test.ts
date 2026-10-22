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
    expect(res.body.error.message).toBe('Email must be a valid email address · Password is required');
  });

  it('camelCase and nested fields read as words; list items are 1-based', () => {
    const s = z.object({ dailyConversionCap: z.number(), rows: z.array(z.object({ payout_value: z.string() })) });
    const r = s.safeParse({ dailyConversionCap: 'ten', rows: [{ payout_value: 'ok' }, { payout_value: 'ok' }, {}] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(describeIssues(r.error, 'x')).toBe('Daily conversion cap must be a number · Rows › #3 › Payout value is required');
    }
  });

  it('an unknown key on a strict schema is named; more than three problems are counted', () => {
    const strict = z.object({ a: z.string() }).strict().safeParse({ a: 'x', foo: 1 });
    if (!strict.success) expect(describeIssues(strict.error, 'x')).toBe('Unknown field: foo');
    const many = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() }).safeParse({});
    if (!many.success) expect(describeIssues(many.error, 'x')).toBe('A is required · B is required · C is required (and 2 more)');
  });

  it('a query string too', async () => {
    const app = appWith((a) => a.get('/r', validateQuery(z.object({ limit: z.coerce.number().int().max(500) }).strict()), (_req, res) => { res.json({ ok: true }); }));
    const res = await request(app).get('/r?limit=9000');
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Limit must be at most 500');
  });
});

describe('plain-English messages for every rule (zod-messages.ts)', () => {
  const msg = (schema: z.ZodTypeAny, value: unknown) => { const r = schema.safeParse(value); return r.success ? null : describeIssues(r.error, 'x'); };
  it('types, lengths, ranges, formats, enums', () => {
    expect(msg(z.object({ name: z.string().min(1) }), { name: '' })).toBe("Name can't be empty");
    expect(msg(z.object({ code: z.string().min(4).max(6) }), { code: 'ab' })).toBe('Code must be at least 4 characters');
    expect(msg(z.object({ code: z.string().max(6) }), { code: 'abcdefgh' })).toBe('Code must be at most 6 characters');
    expect(msg(z.object({ n: z.number().int().positive() }), { n: 0 })).toBe('N must be more than 0');
    expect(msg(z.object({ on: z.boolean() }), { on: 'yes' })).toBe('On must be true or false');
    expect(msg(z.object({ ids: z.array(z.string()).min(1) }), { ids: [] })).toBe('Ids needs at least 1 item');
    expect(msg(z.object({ site: z.string().url() }), { site: 'nope' })).toBe('Site must be a full URL (https://…)');
    expect(msg(z.object({ id: z.string().uuid() }), { id: 'x' })).toBe('Id must be a valid id');
    expect(msg(z.object({ mode: z.enum(['a', 'b']) }), { mode: 'c' })).toBe('Mode must be one of: a, b');
    expect(msg(z.object({ x: z.string() }), { x: null })).toBe("X can't be empty");
    // A schema's own message still wins.
    expect(msg(z.object({ pin: z.string().min(4, 'PIN must have 4 digits.') }), { pin: '1' })).toBe('PIN must have 4 digits.');
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

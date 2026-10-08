/**
 * Backend hardening — PURE tests (no DB; the pg pool and logger are mocked). Covers: the explicit,
 * logged LIST_CAP ceiling; cross-network id rejection on writes; coupon status 'expired' as a
 * list filter; and the validated Control Center usage year.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({ query: (...a: unknown[]) => queryMock(...a) }));
const warnMock = vi.fn();
vi.mock('../../src/lib/logger.js', () => {
  const noop = () => undefined;
  const logger = { warn: (...a: unknown[]) => warnMock(...a), info: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => logger };
  return { logger };
});

const { LIST_CAP, warnIfCapped } = await import('../../src/lib/http/list-cap.js');
const { assertSameNetwork, assertAllSameNetwork } = await import('../../src/lib/db/ownership.js');
const { errorHandler } = await import('../../src/lib/http/envelope.js');
const { couponCodesRoutes } = await import('../../src/surfaces/dashboard/coupon-codes/routes.js');
const { controlCenterRoutes } = await import('../../src/surfaces/dashboard/control-center/routes.js');
const { postbackControlsRoutes } = await import('../../src/surfaces/dashboard/postback-controls/routes.js');

const NET = '33333333-3333-4333-8333-333333333333';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Mount a router behind a fake authenticated admin of NET. */
function appFor(router: express.Router): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { scope: unknown }).scope = { networkId: NET };
    (req as unknown as { identity: unknown }).identity = { surface: 'dashboard', kind: 'admin', role: 'admin', userId: 'u1', networkId: NET };
    next();
  });
  app.use('/', router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  warnMock.mockReset();
});

describe('LIST_CAP / warnIfCapped', () => {
  it('is one explicit constant', () => {
    expect(LIST_CAP).toBe(10_000);
  });

  it('warns (with context + cap) only when a list reaches its cap', () => {
    warnIfCapped([1, 2], 3, 'test.below');
    expect(warnMock).not.toHaveBeenCalled();
    warnIfCapped([1, 2, 3], 3, 'test.at');
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]![0]).toEqual({ context: 'test.at', cap: 3 });
    expect(String(warnMock.mock.calls[0]![1])).toMatch(/LIST_CAP/);
  });
});

describe('cross-network id guards', () => {
  it('assertAllSameNetwork rejects when any id is not in the caller\'s network (count mismatch)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ n: 1 }] });
    await expect(assertAllSameNetwork(NET, 'offers', [A, B], 'targetIds')).rejects.toMatchObject({ status: 400, code: 'bad_request' });
    const [sql, params] = queryMock.mock.calls[0]! as [string, unknown[]];
    expect(sql).toMatch(/FROM offers WHERE network_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/);
    expect(params).toEqual([NET, [A, B]]);
  });

  it('assertAllSameNetwork passes when every (de-duplicated) id is found, and skips empty lists', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ n: 1 }] });
    await expect(assertAllSameNetwork(NET, 'publishers', [A, A], 'partnerIds')).resolves.toBeUndefined();
    await expect(assertAllSameNetwork(NET, 'publishers', [], 'partnerIds')).resolves.toBeUndefined();
    await expect(assertAllSameNetwork(NET, 'publishers', undefined, 'partnerIds')).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('assertSameNetwork rejects a foreign id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(assertSameNetwork(NET, 'partner_tiers', A, 'tierId')).rejects.toThrow(/does not belong/);
  });

  it('postback-control create with a foreign offer id is rejected before any insert', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ n: 0 }] }); // offers count
    const res = await request(appFor(postbackControlsRoutes())).post('/').send({
      name: 'x', controlType: 'reject', targetType: 'offer', targetIds: [A],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0]![0])).not.toMatch(/INSERT/i);
  });
});

describe('coupon-codes list status filter', () => {
  it("accepts status=expired and filters on the stored 'expired' status", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await request(appFor(couponCodesRoutes())).get('/?status=expired');
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0]! as [string, unknown[]];
    expect(sql).toContain(`c.status = 'expired'`);
    expect(sql).toContain(`LIMIT ${LIST_CAP}`);
    expect(params).toEqual([NET]);
  });

  it('keeps all|active|paused and rejects unknown statuses with 422', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const app = appFor(couponCodesRoutes());
    expect((await request(app).get('/?status=paused')).status).toBe(200);
    expect(String(queryMock.mock.calls.at(-1)![0])).toContain(`c.status = 'disabled'`);
    expect((await request(app).get('/?status=all')).status).toBe(200);
    expect((await request(app).get('/?status=bogus')).status).toBe(422);
  });
});

describe('control-center usage year', () => {
  it('a non-numeric or out-of-range year is a 422 validation error', async () => {
    const app = appFor(controlCenterRoutes());
    for (const y of ['abc', '1999', '2101', '2026.5']) {
      const res = await request(app).get(`/usage?year=${y}`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('a valid year is passed to SQL as a number', async () => {
    queryMock.mockImplementation(async (sql: string) => (/FROM networks/.test(sql) ? { rows: [{ settings: {} }] } : { rows: [] }));
    const res = await request(appFor(controlCenterRoutes())).get('/usage?year=2025');
    expect(res.status).toBe(200);
    expect(queryMock.mock.calls[0]![1]).toEqual([NET, 2025]);
  });
});

/**
 * Control Center › History Log — PURE tests (no DB). The filters used to run client-side over a
 * hard LIMIT 200, so counts/export were wrong; they now run in SQL. Asserts every filter is a bind
 * parameter (never SQL text), the query is tenant-scoped on $1, paging is bound, and bad input is
 * rejected by the schema (422) before reaching Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../src/lib/db/pool.js', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

const { auditLogQuery, buildAuditLogWhere, listAuditLog } = await import('../../src/surfaces/dashboard/audit-log/routes.js');

const NET = '33333333-3333-4333-8333-333333333333';
const parse = (q: Record<string, unknown>) => auditLogQuery.safeParse(q);

describe('auditLogQuery schema', () => {
  it('defaults paging and accepts every filter', () => {
    const r = parse({ from: '2026-10-01', to: '2026-10-08T23:59:59.999Z', service: 'offer', portal: 'API', method: 'POST', q: 'bob' });
    expect(r.success).toBe(true);
    if (r.success) { expect(r.data.limit).toBe(50); expect(r.data.offset).toBe(0); }
  });

  it('rejects bad dates, reversed ranges, unknown enums and out-of-range paging', () => {
    expect(parse({ from: 'yesterday' }).success).toBe(false);
    expect(parse({ to: '2026-02-30' }).success).toBe(false);
    expect(parse({ from: '2026-10-09', to: '2026-10-01' }).success).toBe(false);
    expect(parse({ portal: 'Hacker' }).success).toBe(false);
    expect(parse({ method: 'GET' }).success).toBe(false);
    expect(parse({ limit: '0' }).success).toBe(false);
    expect(parse({ limit: '501' }).success).toBe(false);
    expect(parse({ limit: 'abc' }).success).toBe(false);
    expect(parse({ offset: '-1' }).success).toBe(false);
    expect(parse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(parse({ service: '' }).success).toBe(false);
  });
});

describe('buildAuditLogWhere', () => {
  it('scopes to network_id = $1 with no filters', () => {
    const { where, params } = buildAuditLogWhere(NET, {});
    expect(where).toBe('al.network_id = $1');
    expect(params).toEqual([NET]);
  });

  it('binds every filter value as a parameter — none is interpolated into SQL', () => {
    const evil = "x'; DROP TABLE audit_log; --";
    const { where, params } = buildAuditLogWhere(NET, {
      from: '2026-10-01', to: '2026-10-08', service: evil, portal: 'Platform Admin', method: 'DELETE', q: '50%_off',
    });
    expect(where.startsWith('al.network_id = $1')).toBe(true);
    expect(where).not.toContain('DROP TABLE');
    expect(where).not.toContain('2026-10-01');
    expect(where).not.toContain('platform_admin');
    expect(params[0]).toBe(NET);
    expect(params).toContain('2026-10-01');
    expect(params).toContain('2026-10-08');
    expect(params).toContain(evil);
    expect(params).toContain('platform_admin');
    expect(params).toContainEqual(['delete', 'clear']);
    // LIKE metacharacters are escaped and paired with ESCAPE.
    expect(params).toContain('%50\\%\\_off%');
    expect(where).toContain("ESCAPE '\\'");
    // Every $n placeholder refers to a bound param.
    const placeholders = [...where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...placeholders)).toBe(params.length);
  });

  it('Scheduled Action filters on the system actor (bound)', () => {
    const { where, params } = buildAuditLogWhere(NET, { method: 'Scheduled Action' });
    expect(where).toBe('al.network_id = $1 AND al.actor_type = $2');
    expect(params).toEqual([NET, 'system']);
  });
});

describe('listAuditLog', () => {
  beforeEach(() => queryMock.mockReset());

  it('returns a page + filtered total; limit/offset are bound after the filter params', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '123' }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'a', ref: '7', created_at: '2026-10-01T00:00:00Z', action: 'offer.create', entity_type: 'offer',
        actor_type: 'user', actor_id: 'u1', ip: '1.2.3.4', user_agent: 'UA', employee_name: 'Bob', employee_email: null,
      }] });
    const r = parse({ portal: 'Dashboard', limit: '25', offset: '50' });
    if (!r.success) throw new Error('parse failed');
    const out = await listAuditLog(NET, r.data);
    expect(out.total).toBe(123);
    expect(out.limit).toBe(25);
    expect(out.offset).toBe(50);
    expect(out.rows[0]).toMatchObject({ ref: 7, service: 'Offer', method: 'POST', portal: 'Dashboard', employee: 'Bob', isNew: true });

    const [countSql, countParams] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('al.network_id = $1');
    expect(countParams).toEqual([NET, 'user']);
    const [pageSql, pageParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(pageSql).toContain('al.network_id = $1');
    expect(pageSql).toMatch(/LIMIT \$3 OFFSET \$4/);
    expect(pageParams).toEqual([NET, 'user', 25, 50]);
  });
});

/** Postgres pool size per process (lib/db/pool.ts): small on a Supabase session pooler, where every process shares its 15 clients. */
import { describe, it, expect } from 'vitest';
import { isSessionPooler, poolMax } from '../../src/lib/db/pool.js';

describe('pool size', () => {
  const session = 'postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  const transaction = 'postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
  const direct = 'postgresql://postgres:pw@db.abc.supabase.co:5432/postgres';
  const local = 'postgres://tracker:x@localhost:5432/tracker';

  it('recognises the Supabase session pooler (port 5432 on pooler.supabase.com) only', () => {
    expect([session, transaction, direct, local, 'not a url'].map(isSessionPooler)).toEqual([true, false, false, false, false]);
  });

  it('3 per process on the session pooler (5 processes = its 15 clients); else 20 in production / 10; DB_POOL_MAX wins', () => {
    expect(poolMax(session, undefined, false)).toBe(3);
    expect(poolMax(session, undefined, true)).toBe(3);
    expect(poolMax(local, undefined, false)).toBe(10);
    expect(poolMax(transaction, undefined, true)).toBe(20);
    expect(poolMax(session, 5, false)).toBe(5);
  });
});

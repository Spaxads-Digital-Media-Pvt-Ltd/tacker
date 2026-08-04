/**
 * Cross-tenant AND cross-owner isolation — structural enforcement (spec §3A, non-negotiable #5).
 *
 * These are PURE tests: they assert ScopedDb refuses to build an unscoped/mis-scoped query and
 * throws BEFORE any SQL executes (deny-by-default). The end-to-end HTTP variants that actively
 * attempt X-accessing-Y and network-A-accessing-network-B land as endpoints arrive (Phase 1+);
 * this file is the harness they extend.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ScopedDb } from '../../src/lib/db/scoped-db.js';
import { TABLE_SCOPES } from '../../src/lib/db/table-registry.js';

// Register a representative owner-scoped table for the harness (Phase 1 registers real ones).
beforeAll(() => {
  TABLE_SCOPES['test_owner_scoped'] = { tenantColumn: 'network_id', ownerColumn: 'publisher_id' };
});

describe('ScopedDb construction', () => {
  it('refuses an empty networkId', () => {
    expect(() => ScopedDb.forNetwork('')).toThrow(/networkId/);
  });

  it('refuses forOwner without an ownerId', () => {
    expect(() => ScopedDb.forOwner('net-1', '')).toThrow(/ownerId/);
  });

  it('constructs with valid scope', () => {
    expect(ScopedDb.forNetwork('net-1').scope).toEqual({ networkId: 'net-1' });
    expect(ScopedDb.forOwner('net-1', 'own-1').scope).toEqual({
      networkId: 'net-1',
      ownerId: 'own-1',
    });
  });
});

describe('deny-by-default scoping (throws before any SQL runs)', () => {
  it('rejects querying an unregistered table', async () => {
    await expect(ScopedDb.forNetwork('net-1').selectMany('not_registered')).rejects.toThrow(
      /not registered/,
    );
  });

  it('rejects an owner-scoped table when the caller has no ownerId', async () => {
    // Tenant-only scope hitting an owner-scoped table must throw (owner isolation, §3A).
    await expect(
      ScopedDb.forNetwork('net-1').selectMany('test_owner_scoped'),
    ).rejects.toThrow(/owner-scoped/);
  });

  it('rejects inserting into an owner-scoped table without owner scope', async () => {
    await expect(
      ScopedDb.forNetwork('net-1').insert('test_owner_scoped', { foo: 'bar' }),
    ).rejects.toThrow(/owner-scoped|forOwner/);
  });

  it('rejects unsafe SQL identifiers', async () => {
    await expect(
      ScopedDb.forNetwork('net-1').selectMany('networks; DROP TABLE users'),
    ).rejects.toThrow(/Unsafe SQL identifier|not registered/);
  });
});

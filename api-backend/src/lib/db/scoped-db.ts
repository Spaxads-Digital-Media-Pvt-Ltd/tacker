/**
 * ScopedDb — the structural enforcement point for BOTH isolation levels (spec §3A, §5 non-neg).
 *
 *   Tenant isolation:  every query is filtered by `network_id`.
 *   Owner isolation:   tables that declare an `ownerColumn` are ALSO filtered by the caller's
 *                      `owner_id` (publisher X can never read publisher Y in the same network).
 *
 * The whole point: it is HARD to write a query that forgets scope. You cannot construct a
 * ScopedDb without a networkId; you cannot query an owner-scoped table without an ownerId.
 * Missing scope THROWS (deny-by-default) — it never falls through to a permissive query.
 *
 * This is defense-in-depth ABOVE Postgres RLS, not instead of it (spec §2, §12).
 *
 * NOTE: table and column identifiers come from the trusted TABLE_SCOPES registry or are
 * validated against a strict identifier pattern; all VALUES are parameterized ($1, $2, …).
 */
import type { QueryResultRow } from 'pg';
import { query } from './pool.js';
import { getTableScope } from './table-registry.js';

const IDENT = /^[a-z_][a-z0-9_]*$/i;
function assertIdent(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error(`Unsafe SQL identifier: "${name}"`);
  }
  return name;
}

/** Pagination guardrails (spec §3B — bounded queries everywhere). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface RequestScope {
  networkId: string;
  /** Present for owner-bound callers (a publisher/advertiser/user acting only as themselves). */
  ownerId?: string;
}

export interface SelectOptions {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export class ScopedDb {
  private constructor(readonly scope: RequestScope) {}

  /** Tenant-only scope. Use for admin/admin reads across a whole network. */
  static forNetwork(networkId: string): ScopedDb {
    if (!networkId) throw new Error('ScopedDb.forNetwork requires a non-empty networkId');
    return new ScopedDb({ networkId });
  }

  /** Tenant + owner scope. Use for publisher/advertiser callers bound to their own data. */
  static forOwner(networkId: string, ownerId: string): ScopedDb {
    if (!networkId) throw new Error('ScopedDb.forOwner requires a non-empty networkId');
    if (!ownerId) throw new Error('ScopedDb.forOwner requires a non-empty ownerId');
    return new ScopedDb({ networkId, ownerId });
  }

  /** Build the mandatory scope predicate + params for a table. */
  private scopeClause(table: string, startIndex: number): { sql: string; params: unknown[] } {
    const t = getTableScope(assertIdent(table));
    const clauses: string[] = [];
    const params: unknown[] = [];
    let i = startIndex;

    clauses.push(`${assertIdent(t.tenantColumn)} = $${i++}`);
    params.push(this.scope.networkId);

    if (t.ownerColumn) {
      if (!this.scope.ownerId) {
        throw new Error(
          `Table "${table}" is owner-scoped but this request has no ownerId in scope ` +
            `(spec §3A owner isolation). Use ScopedDb.forOwner().`,
        );
      }
      clauses.push(`${assertIdent(t.ownerColumn)} = $${i++}`);
      params.push(this.scope.ownerId);
    }

    return { sql: clauses.join(' AND '), params };
  }

  async selectMany<T extends QueryResultRow = QueryResultRow>(
    table: string,
    opts: SelectOptions = {},
  ): Promise<T[]> {
    const scope = this.scopeClause(table, 1);
    const params = [...scope.params];
    const where: string[] = [scope.sql];

    for (const [col, val] of Object.entries(opts.where ?? {})) {
      where.push(`${assertIdent(col)} = $${params.length + 1}`);
      params.push(val);
    }

    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = Math.max(0, opts.offset ?? 0);
    const order = opts.orderBy
      ? ` ORDER BY ${assertIdent(opts.orderBy)} ${opts.orderDir === 'asc' ? 'ASC' : 'DESC'}`
      : '';

    const sql =
      `SELECT * FROM ${assertIdent(table)} WHERE ${where.join(' AND ')}` +
      `${order} LIMIT ${limit} OFFSET ${offset}`;
    const { rows } = await query<T>(sql, params);
    return rows;
  }

  async selectOne<T extends QueryResultRow = QueryResultRow>(
    table: string,
    where: Record<string, unknown>,
  ): Promise<T | null> {
    const rows = await this.selectMany<T>(table, { where, limit: 1 });
    return rows[0] ?? null;
  }

  async insert<T extends QueryResultRow = QueryResultRow>(
    table: string,
    values: Record<string, unknown>,
  ): Promise<T> {
    const t = getTableScope(assertIdent(table));
    // Force scope columns onto the row so an insert can never escape the tenant/owner.
    const row: Record<string, unknown> = { ...values, [t.tenantColumn]: this.scope.networkId };
    if (t.ownerColumn) {
      if (!this.scope.ownerId) {
        throw new Error(`Insert into owner-scoped "${table}" requires ScopedDb.forOwner().`);
      }
      row[t.ownerColumn] = this.scope.ownerId;
    }

    const cols = Object.keys(row).map(assertIdent);
    const params = Object.values(row);
    const placeholders = params.map((_, idx) => `$${idx + 1}`);
    const sql =
      `INSERT INTO ${assertIdent(table)} (${cols.join(', ')}) ` +
      `VALUES (${placeholders.join(', ')}) RETURNING *`;
    const { rows } = await query<T>(sql, params);
    const inserted = rows[0];
    if (!inserted) throw new Error(`Insert into ${table} returned no row`);
    return inserted;
  }

  async update<T extends QueryResultRow = QueryResultRow>(
    table: string,
    patch: Record<string, unknown>,
    where: Record<string, unknown>,
  ): Promise<T[]> {
    const patchCols = Object.keys(patch).map(assertIdent);
    if (patchCols.length === 0) throw new Error('update requires at least one column');

    const params: unknown[] = [];
    const setSql = patchCols
      .map((col, idx) => {
        params.push(Object.values(patch)[idx]);
        return `${col} = $${params.length}`;
      })
      .join(', ');

    const scope = this.scopeClause(table, params.length + 1);
    params.push(...scope.params);
    const whereClauses = [scope.sql];
    for (const [col, val] of Object.entries(where)) {
      whereClauses.push(`${assertIdent(col)} = $${params.length + 1}`);
      params.push(val);
    }

    const sql =
      `UPDATE ${assertIdent(table)} SET ${setSql} ` +
      `WHERE ${whereClauses.join(' AND ')} RETURNING *`;
    const { rows } = await query<T>(sql, params);
    return rows;
  }

  async delete(table: string, where: Record<string, unknown>): Promise<number> {
    const scope = this.scopeClause(table, 1);
    const params = [...scope.params];
    const whereClauses = [scope.sql];
    for (const [col, val] of Object.entries(where)) {
      whereClauses.push(`${assertIdent(col)} = $${params.length + 1}`);
      params.push(val);
    }
    const sql = `DELETE FROM ${assertIdent(table)} WHERE ${whereClauses.join(' AND ')}`;
    const { rowCount } = await query(sql, params);
    return rowCount;
  }

  async count(table: string, where: Record<string, unknown> = {}): Promise<number> {
    const scope = this.scopeClause(table, 1);
    const params = [...scope.params];
    const whereClauses = [scope.sql];
    for (const [col, val] of Object.entries(where)) {
      whereClauses.push(`${assertIdent(col)} = $${params.length + 1}`);
      params.push(val);
    }
    const sql = `SELECT COUNT(*)::int AS n FROM ${assertIdent(table)} WHERE ${whereClauses.join(' AND ')}`;
    const { rows } = await query<{ n: number }>(sql, params);
    return rows[0]?.n ?? 0;
  }
}

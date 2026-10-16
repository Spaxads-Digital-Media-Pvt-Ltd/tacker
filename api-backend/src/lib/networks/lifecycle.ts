/**
 * Network lifecycle (audit F-26): soft delete → export → purge.
 *
 * - Soft delete: status 'deleted' + deleted_at. Tracking, the dashboard / portals and the API stop at
 *   once (lib/networks/state.ts); every row is kept and PATCH status 'active' restores it.
 * - Export: every row the network owns, as NDJSON, from one consistent snapshot (REPEATABLE READ),
 *   with credentials redacted. Records exported_at.
 * - Purge (the old hard delete, now separate and confirmed): only a soft-deleted network, past the
 *   NETWORK_PURGE_GRACE_DAYS grace period, with an export taken since the delete (or explicitly
 *   waived), and `confirm` = its slug. Its Supabase logins are deleted FIRST — if one can't be, nothing
 *   is purged (no orphaned logins, retry is safe) — then its data. Kept: the platform's own audit rows
 *   (actor platform_admin; network_id becomes NULL) and — DECISION — its money ledger rows: the ledger
 *   is append-only (a trigger forbids DELETE) and is the financial record, so a purge leaves
 *   ledger_entries in place (included in the export, and still downloadable after the purge — the
 *   purged_networks tombstone keeps whose they were; exportLedgerCsv). Deleting them
 *   would need a narrowly-scoped exception in that trigger — a decision for the owner, not this code.
 */
import type { PoolClient } from 'pg';
import { pool, query } from '../db/pool.js';
import { env } from '../../config/env.js';
import { AppError, notFound, serviceUnavailable, validationFailed } from '../http/errors.js';
import { getSupabaseAdmin } from '../supabase.js';
import { isEncrypted } from '../crypto/secret-box.js';
import { networkStateChanged } from './state.js';
import { csvCell } from '../csv.js';

interface NetworkRow {
  id: string; slug: string; name: string; status: string; deleted_at: Date | null; exported_at: Date | null;
  [k: string]: unknown;
}

const DAY_MS = 86_400_000;
/** Tables that hold a network's rows but have no foreign key to networks (so no cascade). */
const FKLESS = ['clicks', 'conversions', 'postback_logs', 'ledger_entries'] as const;
/**
 * The platform team's own records about a network (sales leads, tasks, account notes…) reference it but
 * aren't its data: never in its export. (A purge still cascades / nulls them through their foreign keys.)
 */
export const PLATFORM_ONLY_TABLES: readonly string[] = ['sales_leads', 'platform_tasks', 'network_accounts', 'network_health_history', 'network_notes', 'support_tickets', 'subscription_discounts'];
/** Credentials never leave in an export. */
const REDACT: Record<string, string[]> = {
  networks: ['postback_security_code'], api_keys: ['key_hash'], offers: ['security_code'],
  advertisers: ['verification_token'], tracking_domains: ['verification_token'],
};
const SECRET_KEY_RE = /(key|token|secret|password)$/i;
const REDACTED = '[redacted]';

async function loadNetwork(id: string): Promise<NetworkRow> {
  const row = (await query<NetworkRow>('SELECT * FROM networks WHERE id = $1', [id])).rows[0];
  if (!row) throw notFound('Network not found');
  return row;
}

export const purgeAfter = (deletedAt: Date): Date => new Date(deletedAt.getTime() + env.NETWORK_PURGE_GRACE_DAYS * DAY_MS);

/** Soft delete: stop the network, keep everything. Idempotent (keeps the first deleted_at). */
export async function softDeleteNetwork(id: string): Promise<{ before: NetworkRow; after: NetworkRow }> {
  const before = await loadNetwork(id);
  const { rows } = await query<NetworkRow>(
    `UPDATE networks SET status = 'deleted', deleted_at = COALESCE(deleted_at, now()) WHERE id = $1 RETURNING *`, [id]);
  await networkStateChanged(id);
  return { before, after: rows[0]! };
}

// ---- Export ------------------------------------------------------------------------------------

/** Settings secrets → '[redacted]': encrypted values, and string values under credential-like keys. */
function redactSecrets(v: unknown, key = ''): unknown {
  if (typeof v === 'string') return isEncrypted(v) || (SECRET_KEY_RE.test(key) && v !== '') ? REDACTED : v;
  if (Array.isArray(v)) return v.map((x) => redactSecrets(x));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactSecrets(x, k)]));
  return v;
}

function redactRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  for (const col of REDACT[table] ?? []) if (row[col] != null) row[col] = REDACTED;
  if (table === 'networks' && row['settings']) row['settings'] = redactSecrets(row['settings']);
  return row;
}

async function tenantTables(client: Pick<PoolClient, 'query'>): Promise<{ table: string; column: string }[]> {
  const { rows } = await client.query<{ table: string; column: string }>(
    `SELECT DISTINCT c.conrelid::regclass::text AS table, a.attname AS column
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.confrelid = 'networks'::regclass AND c.contype = 'f'
      ORDER BY 1`);
  return [...rows.filter((r) => !PLATFORM_ONLY_TABLES.includes(r.table)), ...FKLESS.map((table) => ({ table, column: 'network_id' }))];
}

const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * Write the network's data as NDJSON lines through `write` (which should honour backpressure): a
 * header line, then `{"table": …, "row": …}` per row — the network itself first, then every table
 * that holds its rows — all from one snapshot. Sets exported_at when complete.
 */
export async function exportNetwork(id: string, write: (line: string) => Promise<void>): Promise<{ tables: number; rows: number }> {
  const net = await loadNetwork(id);
  const client = await pool.connect();
  let rows = 0;
  let tables = 0;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const list = await tenantTables(client);
    await write(`${JSON.stringify({ export: { format: 'tracker-network-ndjson/1', networkId: id, slug: net.slug, exportedAt: new Date().toISOString(), tables: ['networks', ...list.map((t) => t.table)] } })}\n`);
    const self = (await client.query<Record<string, unknown>>('SELECT * FROM networks WHERE id = $1', [id])).rows[0]!;
    await write(`${JSON.stringify({ table: 'networks', row: redactRow('networks', self) })}\n`);
    rows++;
    for (const { table, column } of list) {
      tables++;
      await client.query(`DECLARE export_cur NO SCROLL CURSOR FOR SELECT * FROM ${ident(table)} WHERE ${ident(column)} = $1`, [id]);
      for (;;) {
        const batch = await client.query<Record<string, unknown>>('FETCH 500 FROM export_cur');
        if (!batch.rows.length) break;
        let chunk = '';
        for (const r of batch.rows) chunk += `${JSON.stringify({ table, row: redactRow(table, r) })}\n`;
        rows += batch.rows.length;
        await write(chunk);
      }
      await client.query('CLOSE export_cur');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await query('UPDATE networks SET exported_at = now() WHERE id = $1', [id]);
  return { tables: tables + 1, rows };
}

// ---- Ledger (CSV) ------------------------------------------------------------------------------

const LEDGER_COLUMNS = ['id', 'created_at', 'entry_type', 'direction', 'amount', 'currency', 'status', 'account_type', 'account_id', 'conversion_id'] as const;

/**
 * A network's money ledger as CSV, oldest first, from one snapshot — for a live network or a purged
 * one (ledger rows outlive the purge; the purged_networks tombstone says whose they were). Amounts are
 * the stored numeric text, never a float.
 */
export async function exportLedgerCsv(id: string, write: (chunk: string) => Promise<void>): Promise<{ rows: number }> {
  const client = await pool.connect();
  let rows = 0;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await write(`${LEDGER_COLUMNS.join(',')}\n`);
    await client.query(
      `DECLARE ledger_cur NO SCROLL CURSOR FOR
         SELECT id, created_at, entry_type, direction, amount::text AS amount, currency, status, account_type, account_id, conversion_id
           FROM ledger_entries WHERE network_id = $1 ORDER BY created_at, id`, [id]);
    for (;;) {
      const batch = await client.query<Record<string, unknown>>('FETCH 1000 FROM ledger_cur');
      if (!batch.rows.length) break;
      await write(batch.rows.map((r) => `${LEDGER_COLUMNS.map((c) => csvCell(r[c])).join(',')}\n`).join(''));
      rows += batch.rows.length;
    }
    await client.query('CLOSE ledger_cur');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { rows };
}

// ---- Purge -------------------------------------------------------------------------------------

/** Every Supabase login of the network: the ones its users / partners / advertisers link, and any
 *  other whose claims name the network. */
async function networkAuthUsers(id: string): Promise<{ linked: string[]; scan: () => Promise<string[]> }> {
  const { rows } = await query<{ id: string }>(
    `SELECT auth_user_id::text AS id FROM users WHERE network_id = $1 AND auth_user_id IS NOT NULL
     UNION SELECT auth_user_id::text FROM publishers WHERE network_id = $1 AND auth_user_id IS NOT NULL
     UNION SELECT auth_user_id::text FROM advertisers WHERE network_id = $1 AND auth_user_id IS NOT NULL`, [id]);
  const scan = async (): Promise<string[]> => {
    const sb = getSupabaseAdmin();
    const found: string[] = [];
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw serviceUnavailable(`Could not list logins: ${error.message} — nothing was purged.`);
      for (const u of data.users) if ((u.app_metadata as Record<string, unknown> | undefined)?.['network_id'] === id) found.push(u.id);
      if (data.users.length < 1000) break;
    }
    return found;
  };
  return { linked: rows.map((r) => r.id), scan };
}

export interface PurgeResult {
  purged: true;
  authUsersDeleted: number;
  rowsDeleted: { clicks: number; conversions: number; postbackLogs: number; auditLog: number; loginEvents: number };
  ledgerEntriesRetained: number;
}

export async function purgeNetwork(
  id: string, opts: { confirm: string; acknowledgeNoExport?: boolean; purgedBy?: string | null }, now: Date = new Date(),
): Promise<{ before: NetworkRow; result: PurgeResult }> {
  const net = await loadNetwork(id);
  if (net.status !== 'deleted' || !net.deleted_at) {
    throw new AppError('conflict', 'Only a deleted network can be purged — DELETE /platform/networks/:id first (it can still be restored).', { reason: 'not_deleted' });
  }
  if (opts.confirm !== net.slug) throw validationFailed(`To purge, send confirm = the network's slug ("${net.slug}").`);
  const after = purgeAfter(net.deleted_at);
  if (now < after) {
    throw new AppError('conflict', `This network can be purged from ${after.toISOString()} (${env.NETWORK_PURGE_GRACE_DAYS}-day grace period after its deletion).`, { reason: 'grace_period', purgeAfter: after.toISOString() });
  }
  if (!opts.acknowledgeNoExport && !(net.exported_at && net.exported_at >= net.deleted_at)) {
    throw new AppError('conflict', 'Export the network first (GET /platform/networks/:id/export), or send acknowledgeNoExport: true to purge without one.', { reason: 'no_export' });
  }

  // Logins first: a purge never leaves Supabase users behind. Each one deleted (or already gone);
  // any other failure stops here with nothing purged — run it again.
  const { linked, scan } = await networkAuthUsers(id);
  let configured = true;
  try { getSupabaseAdmin(); } catch { configured = false; }
  if (!configured && linked.length) {
    throw serviceUnavailable(`This network has ${linked.length} login(s) and Supabase Auth is not configured on this server, so they can't be deleted — nothing was purged.`);
  }
  const ids = configured ? Array.from(new Set([...linked, ...(await scan())])) : [];
  let authUsersDeleted = 0;
  for (const userId of ids) {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);
    if (error && !(error.status === 404 || (error as { code?: string }).code === 'user_not_found')) {
      throw serviceUnavailable(`Could not delete login ${userId}: ${error.message} — nothing was purged (logins deleted so far stay deleted; run the purge again).`);
    }
    if (!error) authUsersDeleted++;
  }

  const client = await pool.connect();
  const counts = { clicks: 0, conversions: 0, postbackLogs: 0, auditLog: 0, loginEvents: 0 };
  let ledgerEntriesRetained = 0;
  try {
    await client.query('BEGIN');
    counts.clicks = (await client.query('DELETE FROM clicks WHERE network_id = $1', [id])).rowCount ?? 0;
    counts.conversions = (await client.query('DELETE FROM conversions WHERE network_id = $1', [id])).rowCount ?? 0;
    counts.postbackLogs = (await client.query('DELETE FROM postback_logs WHERE network_id = $1', [id])).rowCount ?? 0;
    // The tenant's own audit trail and login history go with it; the platform's audit rows stay.
    counts.auditLog = (await client.query(`DELETE FROM audit_log WHERE network_id = $1 AND actor_type <> 'platform_admin'`, [id])).rowCount ?? 0;
    counts.loginEvents = (await client.query('DELETE FROM login_events WHERE network_id = $1', [id])).rowCount ?? 0;
    ledgerEntriesRetained = Number((await client.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM ledger_entries WHERE network_id = $1', [id])).rows[0]?.n ?? 0);
    // The tombstone (D3): who the network was and when it went — Super Admin still lists it and hands
    // out its retained ledger. Same transaction: a purge never leaves a network without one.
    await client.query(
      `INSERT INTO purged_networks (id, name, slug, default_currency, created_at, deleted_at, exported_at, purged_at, purged_by,
                                    ledger_entries_retained, auth_users_deleted, rows_deleted)
       SELECT id, name, slug, default_currency, created_at, deleted_at, exported_at, $2, $3, $4, $5, $6 FROM networks WHERE id = $1`,
      [id, now, opts.purgedBy ?? null, ledgerEntriesRetained, authUsersDeleted, JSON.stringify(counts)]);
    await client.query('DELETE FROM networks WHERE id = $1', [id]); // cascades to every table with a FK to it
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await networkStateChanged(id);
  return { before: net, result: { purged: true, authUsersDeleted, rowsDeleted: counts, ledgerEntriesRetained } };
}


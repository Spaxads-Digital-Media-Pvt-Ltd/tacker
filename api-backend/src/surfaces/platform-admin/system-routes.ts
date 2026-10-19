/**
 * Super Admin › Platform › System health, and the console's global search.
 *
 * - /system (platform:read): this server (version, Node, uptime), Postgres (round trip, pool, connections,
 *   size, the latest migration, the largest tables), Redis (round trip, memory, clients) and every background
 *   queue (waiting / active / delayed / failed, workers listening, the last job finished, schedules).
 * - /system/queues/:name/failed (platform:read): the latest failed jobs (name, reason, attempts — never payloads);
 *   /retry-failed and /clean-failed (platform:full, audited).
 * - /search?q= (any member): networks (or a team member's email), leads, tickets (#number), invoices and staff —
 *   each group only if the role may read it, an 'assigned' role only its networks / leads.
 */
import { Router, type Request } from 'express';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http/async-handler.js';
import { sendOk } from '../../lib/http/envelope.js';
import { validateQuery } from '../../lib/http/validate.js';
import { notFound } from '../../lib/http/errors.js';
import { query, getPoolStats } from '../../lib/db/pool.js';
import { containsPattern } from '../../lib/db/like.js';
import { getRedis } from '../../lib/redis.js';
import { getQueue, QUEUE, type QueueName } from '../../lib/queues.js';
import { writePlatformAudit } from '../../lib/audit.js';
import { requirePerm, can, networkScope, isAssignedScope } from './auth.js';
import { meId } from './fields.js';

const require = createRequire(import.meta.url);
const VERSION = (() => { try { return (require('../../../package.json') as { version?: string }).version ?? 'unknown'; } catch { return 'unknown'; } })();
const QUEUES = Object.values(QUEUE) as QueueName[];

const timed = async <T>(fn: () => Promise<T>): Promise<{ ms: number; value: T | null; error: string | null }> => {
  const t = performance.now();
  try { const value = await fn(); return { ms: Math.round((performance.now() - t) * 10) / 10, value, error: null }; }
  catch (e) { return { ms: Math.round((performance.now() - t) * 10) / 10, value: null, error: e instanceof Error ? e.message : 'failed' }; }
};

/** "used_memory_human:1.23M" lines → { used_memory_human: '1.23M' }. */
const parseInfo = (info: string) => Object.fromEntries(info.split(/\r?\n/).filter((l) => l.includes(':')).map((l) => l.split(':') as [string, string]));

export function systemRoutes(): Router {
  const r = Router();

  r.get('/system', requirePerm('platform', 'read'), asyncHandler(async (_req, res) => {
    const [db, conns, size, migration, tables, redis, queues] = await Promise.all([
      timed(() => query('SELECT 1')),
      timed(async () => (await query<{ used: number; max: string }>(
        `SELECT (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::int AS used, current_setting('max_connections') AS max`)).rows[0]),
      timed(async () => (await query<{ size: string }>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`)).rows[0]?.size),
      timed(async () => (await query<{ name: string; run_on: Date }>(`SELECT name, run_on FROM pgmigrations ORDER BY id DESC LIMIT 1`)).rows[0]),
      timed(async () => (await query<{ table: string; size: string; rows: string }>(
        `SELECT c.relname AS table, pg_size_pretty(pg_total_relation_size(c.oid)) AS size, c.reltuples::bigint::text AS rows
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8`)).rows),
      timed(async () => {
        const redisClient = getRedis();
        await redisClient.ping();
        const info = parseInfo(await redisClient.info());
        return { version: info['redis_version'], memory: info['used_memory_human'], clients: Number(info['connected_clients'] ?? 0), uptimeDays: Math.floor(Number(info['uptime_in_seconds'] ?? 0) / 86400) };
      }),
      Promise.all(QUEUES.map(async (name) => {
        const q = getQueue(name);
        const out = await timed(async () => {
          const [counts, workers, last, schedules] = await Promise.all([
            q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused'),
            q.getWorkersCount(),
            q.getJobs(['completed'], 0, 0),
            q.getRepeatableJobs(0, 5),
          ]);
          return { counts, workers, lastFinishedAt: last[0]?.finishedOn ? new Date(last[0].finishedOn).toISOString() : null,
            schedules: schedules.map((s) => ({ every: s.every ? Number(s.every) : null, pattern: s.pattern ?? null, next: s.next ? new Date(s.next).toISOString() : null })) };
        });
        return { name, ...(out.value ?? { counts: null, workers: 0, lastFinishedAt: null, schedules: [] }), error: out.error };
      })),
    ]);
    const pool = await getPoolStats();
    sendOk(res, {
      server: { version: VERSION, node: process.version, uptimeSeconds: Math.round(process.uptime()), env: process.env['NODE_ENV'] ?? 'development', now: new Date().toISOString(), memoryMb: Math.round(process.memoryUsage().rss / 1048576) },
      database: { ok: !db.error, roundTripMs: db.ms, error: db.error, pool, connections: conns.value ?? null, size: size.value ?? null, latestMigration: migration.value ?? null, largestTables: tables.value ?? [] },
      redis: { ok: !redis.error, roundTripMs: redis.ms, error: redis.error, ...(redis.value ?? {}) },
      queues,
    });
  }));

  const queueParam = (req: Request): QueueName => {
    const name = req.params['name'] as QueueName;
    if (!QUEUES.includes(name)) throw notFound('No such queue');
    return name;
  };

  r.get('/system/queues/:name/failed', requirePerm('platform', 'read'), asyncHandler(async (req, res) => {
    const jobs = await getQueue(queueParam(req)).getJobs(['failed'], 0, 19);
    sendOk(res, jobs.map((j) => ({ id: j.id, name: j.name, failedReason: j.failedReason, attemptsMade: j.attemptsMade, failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null })));
  }));

  r.post('/system/queues/:name/retry-failed', requirePerm('platform', 'full'), asyncHandler(async (req, res) => {
    const name = queueParam(req);
    const jobs = await getQueue(name).getJobs(['failed'], 0, 499);
    let retried = 0;
    for (const j of jobs) { try { await j.retry(); retried++; } catch { /* already retried or gone */ } }
    await writePlatformAudit(req, null, { action: 'system.queue_retry', entityType: 'queue', entityId: name, after: { retried } });
    sendOk(res, { retried });
  }));

  r.post('/system/queues/:name/clean-failed', requirePerm('platform', 'full'), asyncHandler(async (req, res) => {
    const name = queueParam(req);
    const removed = (await getQueue(name).clean(0, 1000, 'failed')).length;
    await writePlatformAudit(req, null, { action: 'system.queue_clean', entityType: 'queue', entityId: name, after: { removed } });
    sendOk(res, { removed });
  }));

  // ---------- Global search ----------
  r.get('/search', validateQuery(z.object({ q: z.string().trim().min(1).max(100) }).strict()), asyncHandler(async (req, res) => {
    const { q } = res.locals.query as { q: string };
    const like = containsPattern(q);
    const number = /^#?\d+$/.test(q) ? q.replace('#', '') : null;
    const assigned = isAssignedScope(req);
    const ns = networkScope(req, 'n', 2);
    const tasks: Promise<[string, unknown[]]>[] = [];
    if (can(req, 'networks', 'read')) {
      tasks.push(query(
        `SELECT n.id, n.name, n.slug, n.status FROM networks n
          WHERE (n.name ILIKE $1 ESCAPE '\\' OR n.slug ILIKE $1 ESCAPE '\\' OR EXISTS (SELECT 1 FROM users u WHERE u.network_id = n.id AND u.email ILIKE $1 ESCAPE '\\'))
            AND ${ns.sql} ORDER BY (n.status = 'deleted'), n.name LIMIT 6`, [like, ...ns.params]).then((x) => ['networks', x.rows]));
    }
    if (can(req, 'sales', 'read')) {
      tasks.push(query(
        `SELECT l.id, l.company, l.contact_name, l.email, l.stage FROM sales_leads l
          WHERE (l.company ILIKE $1 ESCAPE '\\' OR l.email ILIKE $1 ESCAPE '\\' OR l.contact_name ILIKE $1 ESCAPE '\\') AND ($2::uuid IS NULL OR l.owner_id = $2)
          ORDER BY l.updated_at DESC LIMIT 6`, [like, assigned ? meId(req) : null]).then((x) => ['leads', x.rows]));
    }
    if (can(req, 'support', 'read')) {
      tasks.push(query(
        `SELECT t.id, t.number::text AS number, t.subject, t.status, n.name AS network_name FROM support_tickets t JOIN networks n ON n.id = t.network_id
          WHERE (t.subject ILIKE $1 ESCAPE '\\' OR t.number::text = $${ns.params.length + 2} OR t.requester_email ILIKE $1 ESCAPE '\\') AND ${ns.sql}
          ORDER BY t.updated_at DESC LIMIT 6`, [like, ...ns.params, number ?? '']).then((x) => ['tickets', x.rows]));
    }
    if (can(req, 'billing', 'read')) {
      tasks.push(query(
        `SELECT i.id, i.number, i.status, i.total::text AS total, i.currency, COALESCE(n.name, i.bill_to->>'name') AS network_name
           FROM platform_invoices i LEFT JOIN networks n ON n.id = i.network_id
          WHERE (i.number ILIKE $1 ESCAPE '\\' OR i.bill_to->>'name' ILIKE $1 ESCAPE '\\') AND ${ns.sql}
          ORDER BY i.issued_at DESC LIMIT 6`, [like, ...ns.params]).then((x) => ['invoices', x.rows]));
    }
    if (can(req, 'team', 'read')) {
      tasks.push(query(
        `SELECT pa.id, pa.email, pa.name, r.name AS role_name FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
          WHERE pa.email ILIKE $1 ESCAPE '\\' OR pa.name ILIKE $1 ESCAPE '\\' ORDER BY pa.email LIMIT 6`, [like]).then((x) => ['staff', x.rows]));
    }
    sendOk(res, Object.fromEntries(await Promise.all(tasks)));
  }));

  return r;
}

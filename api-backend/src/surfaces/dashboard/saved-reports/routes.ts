/**
 * Saved reports (audit F-24) — the report pages' saved configurations, on the server. Each belongs
 * to the dashboard user who saved it (the SPA syncs its page's list by name; localStorage is only a
 * cache). Scheduling one — a 5-field cron in the network's time zone + recipients + a rolling range —
 * sends its data out of the dashboard, so that part is admin / manager only; the
 * scheduled-reports worker runs it (lib/reporting/saved-reports.ts). Network-scoped throughout.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { forbidden, notFound, validationFailed } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { parseCron, nextCronTime } from '../../../lib/scheduling/cron.js';
import {
  SAVED_REPORT_PAGES, RANGE_PRESETS, savedReportDto, networkTimeZone, sendSavedReport, type SavedReportRow,
} from '../../../lib/reporting/saved-reports.js';

const page = z.enum(SAVED_REPORT_PAGES);
const config = z.record(z.string(), z.unknown()).refine((c) => JSON.stringify(c).length <= 20_000, { message: 'config is too large' });
const listQuery = z.object({ page: page.optional(), scope: z.enum(['mine', 'network']).default('mine') });
const upsertByName = z.object({ page, name: z.string().trim().min(1).max(120), config });
const byName = z.object({ page, name: z.string().trim().min(1).max(120) });
const patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: config.optional(),
  schedule: z.string().trim().max(100).nullable().optional(),
  rangePreset: z.enum(RANGE_PRESETS).optional(),
  recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(20).transform((a) => Array.from(new Set(a))).optional(),
});

function userOf(req: import('express').Request): string {
  const id = req.identity;
  if (!id || id.surface !== 'dashboard' || id.kind !== 'admin') throw forbidden('Dashboard users only.');
  return id.userId;
}
const roleOf = (req: import('express').Request): string =>
  (req.identity?.surface === 'dashboard' && req.identity.kind === 'admin' ? req.identity.role : '') ?? '';

async function load(networkId: string, id: string): Promise<SavedReportRow> {
  const { rows } = await query<SavedReportRow>('SELECT * FROM saved_reports WHERE network_id = $1 AND id = $2', [networkId, id]);
  if (!rows[0]) throw notFound('Saved report not found');
  return rows[0];
}

export function savedReportsRoutes(): Router {
  const r = Router();

  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof listQuery>;
    const params: unknown[] = [req.scope!.networkId];
    const where = ['network_id = $1'];
    if (q.scope === 'mine') { params.push(userOf(req)); where.push(`owner_user_id = $${params.length}`); }
    if (q.page) { params.push(q.page); where.push(`page = $${params.length}`); }
    const { rows } = await query<SavedReportRow>(`SELECT * FROM saved_reports WHERE ${where.join(' AND ')} ORDER BY page, name LIMIT 1000`, params);
    sendOk(res, rows.map(savedReportDto));
  }));

  // Save (create or replace the config of) the caller's report of this name on this page.
  r.put('/by-name', validateBody(upsertByName), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof upsertByName>;
    const { rows } = await query<SavedReportRow>(
      `INSERT INTO saved_reports (network_id, owner_user_id, page, name, config) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (network_id, owner_user_id, page, name) DO UPDATE SET config = EXCLUDED.config
       RETURNING *`,
      [req.scope!.networkId, userOf(req), b.page, b.name, JSON.stringify(b.config)]);
    sendOk(res, savedReportDto(rows[0]!));
  }));

  r.delete('/by-name', validateQuery(byName), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof byName>;
    const n = (await query('DELETE FROM saved_reports WHERE network_id = $1 AND owner_user_id = $2 AND page = $3 AND name = $4',
      [req.scope!.networkId, userOf(req), q.page, q.name])).rowCount ?? 0;
    sendOk(res, { deleted: n > 0 });
  }));

  r.patch('/:id', validateBody(patch), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const before = await load(networkId, req.params.id!);
    const b = req.body as z.infer<typeof patch>;
    const admin = ['admin', 'manager'].includes(roleOf(req));
    if (before.owner_user_id !== userOf(req) && !admin) throw forbidden("Only its owner or an admin / manager can change this saved report.");
    if ((b.schedule !== undefined || b.recipients !== undefined || b.rangePreset !== undefined) && !admin) {
      throw forbidden('Scheduling a report (it emails the data out) needs an admin or manager.');
    }
    const schedule = b.schedule === undefined ? before.schedule : (b.schedule || null);
    const recipients = b.recipients ?? before.recipients;
    let next: Date | null = null;
    if (schedule) {
      try { parseCron(schedule); } catch (err) { throw validationFailed(`schedule: ${(err as Error).message}`); }
      if (!recipients.length) throw validationFailed('Add at least one recipient to schedule this report.');
      next = nextCronTime(schedule, new Date(), await networkTimeZone(networkId));
      if (!next) throw validationFailed('schedule: never runs');
    }
    const { rows } = await query<SavedReportRow>(
      `UPDATE saved_reports SET name = $3, config = $4, schedule = $5, range_preset = $6, recipients = $7, next_run_at = $8
        WHERE network_id = $1 AND id = $2 RETURNING *`,
      [networkId, before.id, b.name ?? before.name, JSON.stringify(b.config ?? before.config), schedule,
        b.rangePreset ?? before.range_preset, recipients, next]);
    if (b.schedule !== undefined || b.recipients !== undefined) {
      await writeAudit(req, {
        action: 'saved_report.schedule', entityType: 'saved_report', entityId: before.id,
        before: { schedule: before.schedule, recipients: before.recipients }, after: { schedule, recipients },
      });
    }
    sendOk(res, savedReportDto(rows[0]!));
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const before = await load(networkId, req.params.id!);
    if (before.owner_user_id !== userOf(req) && !['admin', 'manager'].includes(roleOf(req))) {
      throw forbidden("Only its owner or an admin / manager can delete this saved report.");
    }
    await query('DELETE FROM saved_reports WHERE network_id = $1 AND id = $2', [networkId, before.id]);
    sendOk(res, { deleted: true });
  }));

  // Send it now (same as a scheduled run) — to check a schedule's email before waiting for it.
  r.post('/:id/send', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const row = await load(req.scope!.networkId, req.params.id!);
    if (!row.recipients.length) throw validationFailed('Add at least one recipient first.');
    const { result, rows } = await sendSavedReport(row);
    await writeAudit(req, { action: 'saved_report.send', entityType: 'saved_report', entityId: row.id, after: { sent: result.sent, rows, recipients: result.recipients } });
    sendOk(res, { ...result, rows });
  }));

  return r;
}

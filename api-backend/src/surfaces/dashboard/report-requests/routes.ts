/**
 * Requested Reports (Reporting › Saved & Scheduled) — report files built in the background
 * (lib/reporting/report-requests.ts). A dashboard user requests an export of one of their saved reports
 * (admins / managers: anyone's) over a preset or a date range; the list shows each request with its
 * status, and a finished one is downloaded here as CSV. Everyone sees their own requests; admins and
 * managers can list the network's. Network-scoped throughout; files never get a public URL.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { forbidden, notFound, tooMany, validationFailed } from '../../../lib/http/errors.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { overFixedWindow } from '../../../lib/fixed-window-limit.js';
import { RANGE_PRESETS, type SavedReportRow } from '../../../lib/reporting/saved-reports.js';
import {
  createReportRequest, reportRequestDto, reportRequestFile, requestRange, REQUEST_COLUMNS, type ReportRequestRow,
} from '../../../lib/reporting/report-requests.js';
import { teamMembersByLogin } from '../../../lib/auth/team-members.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const createSchema = z.object({
  savedReportId: z.string().uuid(),
  rangePreset: z.enum(RANGE_PRESETS).optional(),
  from: z.string().regex(DATE, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(DATE, 'to must be YYYY-MM-DD').optional(),
}).refine((b) => (b.from == null) === (b.to == null), { message: 'Give both from and to, or a rangePreset.' })
  .refine((b) => !b.from || !b.to || b.from <= b.to, { message: 'from must be on or before to.' });
const listQuery = z.object({
  scope: z.enum(['mine', 'network']).default('mine'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
/** Exports per person per hour — each one runs the whole report. */
const REQUESTS_PER_HOUR = 30;
/** The longest range one export may cover. */
const MAX_RANGE_DAYS = 366;

function userOf(req: Request): string {
  const id = req.identity;
  if (!id || id.surface !== 'dashboard' || id.kind !== 'admin') throw forbidden('Dashboard users only.');
  return id.userId;
}
const managesAll = (req: Request): boolean =>
  req.identity?.surface === 'dashboard' && req.identity.kind === 'admin' && ['admin', 'manager'].includes(req.identity.role ?? '');

async function load(req: Request, id: string): Promise<ReportRequestRow> {
  const { rows } = await query<ReportRequestRow>(`SELECT ${REQUEST_COLUMNS} FROM report_requests WHERE network_id = $1 AND id = $2`, [req.scope!.networkId, id]);
  const r = rows[0];
  if (!r || (r.requested_by !== userOf(req) && !managesAll(req))) throw notFound('Requested report not found');
  return r;
}

export function reportRequestsRoutes(): Router {
  const r = Router();

  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const q = res.locals.query as z.infer<typeof listQuery>;
    if (q.scope === 'network' && !managesAll(req)) throw forbidden("Only admins and managers can list everyone's requested reports.");
    const params: unknown[] = [req.scope!.networkId];
    let where = 'network_id = $1';
    if (q.scope === 'mine') { params.push(userOf(req)); where += ` AND requested_by = $${params.length}`; }
    const { rows } = await query<ReportRequestRow & { total: number }>(
      `SELECT ${REQUEST_COLUMNS}, COUNT(*) OVER ()::int AS total FROM report_requests WHERE ${where}
        ORDER BY created_at DESC, id LIMIT ${q.limit} OFFSET ${q.offset}`, params);
    const names = await teamMembersByLogin(req.scope!.networkId, [...new Set(rows.map((x) => x.requested_by))]);
    sendOk(res, rows.map((x) => reportRequestDto(x, names.get(x.requested_by)?.name ?? names.get(x.requested_by)?.email ?? null)),
      { limit: q.limit, offset: q.offset, total: rows[0]?.total ?? 0 });
  }));

  // Request an export of a saved report (its own config: filters, metric filters, sort, hidden columns).
  r.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    const { rows } = await query<SavedReportRow>('SELECT * FROM saved_reports WHERE network_id = $1 AND id = $2', [networkId, b.savedReportId]);
    const saved = rows[0];
    if (!saved || (saved.owner_user_id !== userOf(req) && !managesAll(req))) throw notFound('Saved report not found');
    if (b.from && b.to && (Date.parse(`${b.to}T00:00:00Z`) - Date.parse(`${b.from}T00:00:00Z`)) / 86_400_000 >= MAX_RANGE_DAYS) {
      throw validationFailed(`An export can cover at most ${MAX_RANGE_DAYS} days.`);
    }
    if (await overFixedWindow(`rrexport:${networkId}:${userOf(req)}`, REQUESTS_PER_HOUR, 3600)) {
      throw tooMany(`You can request ${REQUESTS_PER_HOUR} exports an hour — try again later.`);
    }
    const range = await requestRange(networkId, b);
    const row = await createReportRequest(networkId, {
      requestedBy: userOf(req), savedReportId: saved.id, name: saved.name, page: saved.page, config: saved.config ?? {}, range,
    });
    await writeAudit(req, { action: 'report_request.create', entityType: 'report_request', entityId: row.id, after: { savedReportId: saved.id, range: range.label } });
    sendOk(res, reportRequestDto(row), undefined, 201);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    sendOk(res, reportRequestDto(await load(req, req.params.id!)));
  }));

  r.get('/:id/download', asyncHandler(async (req, res) => {
    const row = await load(req, req.params.id!);
    const file = row.status === 'done' ? await reportRequestFile(req.scope!.networkId, row.id) : null;
    if (!file) throw notFound(row.status === 'failed' ? `This export failed: ${row.error ?? 'no file'}` : 'This export has no file yet.');
    await writeAudit(req, { action: 'report_request.download', entityType: 'report_request', entityId: row.id });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`);
    res.setHeader('cache-control', 'no-store');
    res.send(file.csv);
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    const row = await load(req, req.params.id!);
    await query('DELETE FROM report_requests WHERE network_id = $1 AND id = $2', [req.scope!.networkId, row.id]);
    sendOk(res, { deleted: true });
  }));

  return r;
}

/**
 * Investigator — saved click/conversion lookups for fraud review. Real queries against clicks and
 * conversions; no separate investigation-results table.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import {
  computeInvestigationStats,
  formatInvestigationTarget,
  runInvestigationReport,
  type InvestigationQueryInput,
} from '../../../lib/investigator/query.js';

const TABLE = 'investigations';

interface InvestigationRow {
  id: string;
  ref: string;
  network_id: string;
  start_date: string;
  end_date: string;
  target_type: 'sub_id' | 'transaction_id' | 'click_id' | 'partner';
  target_value: string | null;
  sub_field: string | null;
  publisher_id: string | null;
  entry_count: number;
  suspect_count: number;
  offer_count: number;
  partner_count: number;
  file_name: string | null;
  created_at: string;
  updated_at: string;
  publisher_name?: string | null;
}

function toQueryInput(row: InvestigationRow): InvestigationQueryInput {
  return {
    networkId: row.network_id,
    startDate: normalizeDate(row.start_date),
    endDate: normalizeDate(row.end_date),
    targetType: row.target_type,
    targetValue: row.target_value,
    subField: row.sub_field,
    publisherId: row.publisher_id,
  };
}

function normalizeDate(d: string | Date): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

const toDto = (r: InvestigationRow) => ({
  id: r.id,
  ref: Number(r.ref),
  startDate: normalizeDate(r.start_date),
  endDate: normalizeDate(r.end_date),
  targetType: r.target_type,
  targetValue: r.target_value,
  subField: r.sub_field,
  publisherId: r.publisher_id,
  target: formatInvestigationTarget(r),
  entryCount: r.entry_count,
  suspectCount: r.suspect_count,
  offerCount: r.offer_count,
  partnerCount: r.partner_count,
  fileName: r.file_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const createSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetType: z.enum(['sub_id', 'transaction_id', 'click_id', 'partner']),
  targetValue: z.string().max(500).optional(),
  subField: z.enum(['sub1', 'sub2', 'sub3', 'sub4', 'sub5']).optional(),
  publisherId: z.string().uuid().optional(),
}).refine((b) => b.startDate <= b.endDate, { message: 'Start date must be on or before end date', path: ['endDate'] })
  .refine((b) => b.targetType !== 'sub_id' || (b.subField && b.targetValue?.trim()), {
    message: 'Sub field and value are required for sub ID target', path: ['targetValue'],
  })
  .refine((b) => b.targetType === 'partner' || b.targetValue?.trim(), {
    message: 'Target value is required', path: ['targetValue'],
  })
  .refine((b) => b.targetType !== 'partner' || b.publisherId, {
    message: 'Partner is required', path: ['publisherId'],
  });

async function fetchRow(networkId: string, id: string): Promise<InvestigationRow | null> {
  const { rows } = await query<InvestigationRow>(
    `SELECT i.*, p.name AS publisher_name
     FROM ${TABLE} i
     LEFT JOIN publishers p ON p.id = i.publisher_id AND p.network_id = i.network_id
     WHERE i.network_id = $1 AND i.id = $2`,
    [networkId, id],
  );
  return rows[0] ?? null;
}

export function investigatorRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const { rows } = await query<InvestigationRow>(
      `SELECT i.*, p.name AS publisher_name
       FROM ${TABLE} i
       LEFT JOIN publishers p ON p.id = i.publisher_id AND p.network_id = i.network_id
       WHERE i.network_id = $1
       ORDER BY i.created_at DESC
       LIMIT 200`,
      [networkId],
    );
    sendOk(res, rows.map(toDto));
  }));

  r.post('/', validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const input: InvestigationQueryInput = {
      networkId,
      startDate: b.startDate,
      endDate: b.endDate,
      targetType: b.targetType,
      targetValue: b.targetValue?.trim() || null,
      subField: b.subField ?? null,
      publisherId: b.publisherId ?? null,
    };
    const stats = await computeInvestigationStats(input);
    const row = await db.insert<InvestigationRow>(TABLE, {
      start_date: b.startDate,
      end_date: b.endDate,
      target_type: b.targetType,
      target_value: b.targetValue?.trim() || null,
      sub_field: b.subField ?? null,
      publisher_id: b.publisherId ?? null,
      entry_count: stats.entryCount,
      suspect_count: stats.suspectCount,
      offer_count: stats.offerCount,
      partner_count: stats.partnerCount,
    });
    const full = await fetchRow(networkId, row.id);
    await writeAudit(req, { action: 'investigation.create', entityType: 'investigation', entityId: row.id, after: full });
    res.status(201);
    sendOk(res, toDto(full!));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await fetchRow(req.scope!.networkId, req.params.id ?? '');
    if (!row) throw notFound('Investigation not found');
    sendOk(res, toDto(row));
  }));

  r.get('/:id/report', asyncHandler(async (req, res) => {
    const row = await fetchRow(req.scope!.networkId, req.params.id ?? '');
    if (!row) throw notFound('Investigation not found');
    const entries = await runInvestigationReport(toQueryInput(row));
    sendOk(res, entries);
  }));

  r.post('/:id/refresh', asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const id = req.params.id ?? '';
    const existing = await fetchRow(networkId, id);
    if (!existing) throw notFound('Investigation not found');
    const stats = await computeInvestigationStats(toQueryInput(existing));
    const db = dbForRequest(req);
    const [updated] = await db.update<InvestigationRow>(TABLE, {
      entry_count: stats.entryCount,
      suspect_count: stats.suspectCount,
      offer_count: stats.offerCount,
      partner_count: stats.partnerCount,
    }, { id });
    const full = await fetchRow(networkId, updated!.id);
    sendOk(res, toDto(full!));
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const id = req.params.id ?? '';
    const existing = await db.selectOne<InvestigationRow>(TABLE, { id });
    if (!existing) throw notFound('Investigation not found');
    await db.delete(TABLE, { id });
    await writeAudit(req, { action: 'investigation.delete', entityType: 'investigation', entityId: id, before: existing });
    sendOk(res, { deleted: true });
  }));

  return r;
}

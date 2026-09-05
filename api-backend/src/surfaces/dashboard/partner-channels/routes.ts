/**
 * Control Center › Segmentation Options › Channels — a real network-scoped catalog a Partner is
 * assigned to (publishers.channel_id). The reference's own list (verified live at
 * /controls/segmentations/channels) shows a real dedicated "Add Channel" page (Name + Active/
 * Inactive), a per-row Edit/Delete kebab, and an "Offers" usage column — computed here as the real
 * count of distinct offers that have received at least one click from a Partner assigned to that
 * channel (real click data, not a fabricated number).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const TABLE = 'partner_channels';

interface Row { id: string; ref: number; name: string; status: string; created_at: string; updated_at: string }
const dto = (r: Row, offerCount = 0) => ({
  id: r.id, ref: r.ref, name: r.name, status: r.status, offerCount, createdAt: r.created_at, updatedAt: r.updated_at,
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'inactive']).default('active'),
});
const updateSchema = createSchema.partial();

export function partnerChannelsRoutes(): Router {
  const r = Router();

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Channel not found');
    sendOk(res, dto(row));
  }));

  r.get('/', asyncHandler(async (req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const where: Record<string, unknown> = {};
    if (status && status !== 'all') {
      if (status !== 'active' && status !== 'inactive') throw badRequest('Invalid status');
      where['status'] = status;
    }
    const db = dbForRequest(req);
    const rows = await db.selectMany<Row>(TABLE, { where, orderBy: 'name', limit: 1000 });
    const { rows: counts } = await query<{ channel_id: string; n: string }>(
      `SELECT p.channel_id, COUNT(DISTINCT c.offer_id) AS n
         FROM clicks c JOIN publishers p ON p.id = c.publisher_id
        WHERE p.network_id = $1 AND p.channel_id IS NOT NULL
        GROUP BY p.channel_id`,
      [req.scope!.networkId],
    );
    const byChannel = new Map(counts.map((c) => [c.channel_id, Number(c.n)]));
    sendOk(res, rows.map((row) => dto(row, byChannel.get(row.id) ?? 0)));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const row = await dbForRequest(req).insert<Row>(TABLE, { name: b.name, status: b.status });
    await writeAudit(req, { action: 'partner_channel.create', entityType: TABLE, entityId: row.id, after: row });
    res.status(201);
    sendOk(res, dto(row));
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    const [row] = await dbForRequest(req).update<Row>(TABLE, patch, { id: req.params.id });
    if (!row) throw notFound('Channel not found');
    await writeAudit(req, { action: 'partner_channel.update', entityType: TABLE, entityId: req.params.id, after: row });
    sendOk(res, dto(row));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete(TABLE, { id: req.params.id });
    if (n === 0) throw notFound('Channel not found');
    await writeAudit(req, { action: 'partner_channel.delete', entityType: TABLE, entityId: req.params.id });
    sendOk(res, { deleted: true });
  }));

  return r;
}

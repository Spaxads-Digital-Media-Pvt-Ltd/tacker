/**
 * Manage Applications › Questionnaires — reusable field sets an Offer can require applicants to
 * fill out (offers.questionnaire_id, see the offer-applications migration). Field ordering is the
 * array order of `fields` on create/update (full replace, matching the reference's inline editor
 * which has no separate reorder-save step). Tenant-scoped by network_id (§3A).
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
import { requireRole } from '../auth.js';

const TABLE = 'questionnaires';

interface Row { id: string; name: string; status: string; created_at: string; updated_at: string }
interface FieldRow {
  id: string; position: number; label: string; required: boolean; tooltip: string | null;
  data_field: string; options: string[] | null;
}
interface OfferPreview { id: string; name: string }

const fieldDTO = (f: FieldRow) => ({
  id: f.id, position: f.position, label: f.label, required: f.required,
  tooltip: f.tooltip, dataField: f.data_field, options: f.options ?? [],
});

const fieldSchema = z.object({
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  tooltip: z.string().max(500).nullable().optional(),
  dataField: z.enum(['checkbox', 'date_input', 'input', 'numeric_input', 'select', 'textarea']),
  options: z.array(z.string().min(1).max(120)).default([]),
});
const baseSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'inactive']).default('active'),
  fields: z.array(fieldSchema).default([]),
});
const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

interface AuditLogRow { id: string; action: string; actor_type: string; actor_id: string | null; ip: string | null; user_agent: string | null; created_at: string }
const METHOD_BY_ACTION_SUFFIX: Record<string, string> = { create: 'POST', update: 'PATCH', delete: 'DELETE' };
const toHistoryDTO = (r: AuditLogRow) => {
  const suffix = r.action.split('.').pop() ?? '';
  return {
    id: r.id, operationTime: r.created_at, service: 'questionnaire', changes: r.action,
    employee: r.actor_id, method: METHOD_BY_ACTION_SUFFIX[suffix] ?? '—',
    portal: r.actor_type === 'user' ? 'Dashboard' : r.actor_type === 'api_key' ? 'API' : r.actor_type === 'platform_admin' ? 'Platform Admin' : 'System',
    userIp: r.ip, userAgent: r.user_agent,
  };
};

async function fieldsFor(questionnaireId: string): Promise<FieldRow[]> {
  const { rows } = await query<FieldRow>(
    `SELECT id, position, label, required, tooltip, data_field, options
       FROM questionnaire_fields WHERE questionnaire_id = $1 ORDER BY position`,
    [questionnaireId],
  );
  return rows;
}

async function offersFor(networkId: string, questionnaireId: string): Promise<OfferPreview[]> {
  const { rows } = await query<OfferPreview>(
    `SELECT id, name FROM offers WHERE network_id = $1 AND questionnaire_id = $2 ORDER BY name`,
    [networkId, questionnaireId],
  );
  return rows;
}

async function replaceFields(db: ReturnType<typeof dbForRequest>, questionnaireId: string, fields: z.infer<typeof fieldSchema>[]): Promise<void> {
  await db.delete('questionnaire_fields', { questionnaire_id: questionnaireId });
  let position = 0;
  for (const f of fields) {
    await db.insert('questionnaire_fields', {
      questionnaire_id: questionnaireId, position: position++, label: f.label, required: f.required,
      tooltip: f.tooltip ?? null, data_field: f.dataField, options: f.options.length ? f.options : null,
    });
  }
}

export function questionnairesRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const statusParam = String(req.query['status'] ?? 'active');
    const rows = await db.selectMany<Row>(TABLE, { limit: 500, orderBy: 'created_at', orderDir: 'desc' });
    const filtered = statusParam === 'all' ? rows : rows.filter((r2) => r2.status === statusParam);
    const out = await Promise.all(filtered.map(async (row) => {
      const [fields, offers] = await Promise.all([fieldsFor(row.id), offersFor(req.scope!.networkId, row.id)]);
      return {
        id: row.id, name: row.name, status: row.status,
        questions: fields.map((f) => f.label), offers: offers.map((o) => o.name),
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
    }));
    sendOk(res, out);
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as z.infer<typeof createSchema>;
    const row = await db.insert<Row>(TABLE, { name: b.name, status: b.status });
    await replaceFields(db, row.id, b.fields);
    await writeAudit(req, { action: 'questionnaire.create', entityType: 'questionnaire', entityId: row.id, after: row });
    res.status(201);
    sendOk(res, { id: row.id, name: row.name, status: row.status, fields: b.fields.map((f, i) => ({ ...f, id: '', position: i })), createdAt: row.created_at, updatedAt: row.updated_at });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!row) throw notFound('Questionnaire not found');
    const fields = await fieldsFor(row.id);
    sendOk(res, { id: row.id, name: row.name, status: row.status, fields: fields.map(fieldDTO), createdAt: row.created_at, updatedAt: row.updated_at });
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Questionnaire not found');
    const b = req.body as z.infer<typeof updateSchema>;
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch['name'] = b.name;
    if (b.status !== undefined) patch['status'] = b.status;
    const [row] = Object.keys(patch).length > 0 ? await db.update<Row>(TABLE, patch, { id: req.params.id }) : [before];
    if (!row) throw notFound('Questionnaire not found');
    if (b.fields !== undefined) await replaceFields(db, row.id, b.fields);
    await writeAudit(req, { action: 'questionnaire.update', entityType: 'questionnaire', entityId: req.params.id, before, after: row });
    const fields = await fieldsFor(row.id);
    sendOk(res, { id: row.id, name: row.name, status: row.status, fields: fields.map(fieldDTO), createdAt: row.created_at, updatedAt: row.updated_at });
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Questionnaire not found');
    await db.delete(TABLE, { id: req.params.id });
    await writeAudit(req, { action: 'questionnaire.delete', entityType: 'questionnaire', entityId: req.params.id, before });
    sendOk(res, { deleted: true });
  }));

  r.get('/:id/history', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const existing = await db.selectOne(TABLE, { id: req.params.id });
    if (!existing) throw notFound('Questionnaire not found');
    const { rows } = await query<AuditLogRow>(
      `SELECT id, action, actor_type, actor_id, ip, user_agent, created_at
         FROM audit_log
        WHERE network_id = $1 AND entity_type = 'questionnaire' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 200`,
      [req.scope!.networkId, req.params.id],
    );
    sendOk(res, rows.map(toHistoryDTO));
  }));

  return r;
}

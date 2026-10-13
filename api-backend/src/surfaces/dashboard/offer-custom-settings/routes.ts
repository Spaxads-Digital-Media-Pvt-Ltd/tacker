/**
 * Offer Custom Settings (Offers-flyout parity) — network-wide, category-grouped view (Revenue &
 * Payout / Caps / Throttle Rates / Landing Pages / Creatives) of per-partner overrides on one offer.
 * Tenant-scoped by network_id (spec §3A).
 *
 * The rows are ENFORCED at runtime (audit F-12): active, in-window settings ride on the cached offer
 * config and the tracking surface applies them — see lib/offer-settings/custom-settings.ts for what
 * each category does and the precedence. Every write here busts that offer's cached config.
 *
 * API shape = the v2 columns (migration 1700000054000) in camelCase — what the typed
 * OfferCustomSetting*Form pages send. Every row belongs to one offer (offer_id is NOT NULL), so
 * offerId is required; status is active | inactive. For the simple add/edit modals, a single cap can
 * also be sent flat as capType + capInterval + capValue (it becomes the row's whole `caps`).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { badRequest, notFound } from '../../../lib/http/errors.js';
import { rejectMalformedIdParams } from '../../../lib/http/path-params.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { assertSameNetwork, assertAllSameNetwork } from '../../../lib/db/ownership.js';
import { query } from '../../../lib/db/pool.js';
import { moneySchema } from '../../../lib/money.js';
import { writeAudit } from '../../../lib/audit.js';
import { CAP_KINDS, CAP_INTERVALS, capLimits, type CapsMatrix } from '../../../lib/offer-settings/custom-settings.js';
import { invalidateOfferConfig } from '../../tracking/offer-cache.js';
import { requireRole } from '../auth.js';

const TABLE = 'offer_custom_settings';
const CATEGORIES = ['revenue_payout', 'caps', 'throttle_rates', 'landing_pages', 'creatives'] as const;
const MODELS = ['CPA', 'CPA_PPP', 'CPA_CPS', 'CPA_CPS_PPP', 'CPC', 'CPM', 'CPS', 'CPS_PPP', 'PRV', 'PRV_PPP'] as const;
const CREATIVE_TYPES = ['archive', 'email', 'html', 'image', 'link', 'text', 'thumbnail', 'video'] as const;

interface Row {
  id: string; ref: string; category: string; name: string | null; offer_id: string;
  partner_id: string | null; partner_ids: string[]; apply_all_partners: boolean;
  description: string | null; public_description: string | null; status: string;
  effective_from: string | null; effective_to: string | null; targeting: Record<string, string[]>;
  apply_custom_payout: boolean; payout_model: string | null; payout_value: string | null;
  apply_custom_revenue: boolean; revenue_model: string | null; revenue_value: string | null;
  goal_id: string | null; fire_partner_postback: boolean; caps: CapsMatrix;
  conversion_status: string | null; throttle_rate: string | null; set_parameter_goal: boolean;
  landing_page_url: string | null; creative_type: string | null; creative_url: string | null;
  creative_thumbnail_url: string | null; email_from: string | null; email_subject: string | null;
  created_at: string; updated_at: string;
}

/** The single cap of a one-cap row, flattened for the simple modals (null when 0 or several). */
function singleCap(caps: CapsMatrix): { capType: string; capInterval: string; capValue: number } | null {
  const all = CAP_KINDS.flatMap((k) => capLimits(caps, k).map(([interval, limit]) => ({ capType: k, capInterval: interval, capValue: limit })));
  return all.length === 1 ? all[0]! : null;
}

const dto = (r: Row) => ({
  id: r.id, ref: Number(r.ref), category: r.category, name: r.name, offerId: r.offer_id,
  partnerId: r.partner_id, partnerIds: r.partner_ids, applyAllPartners: r.apply_all_partners,
  description: r.description, publicDescription: r.public_description, status: r.status,
  effectiveFrom: r.effective_from, effectiveTo: r.effective_to, targeting: r.targeting,
  applyCustomPayout: r.apply_custom_payout, payoutModel: r.payout_model, payoutValue: r.payout_value,
  applyCustomRevenue: r.apply_custom_revenue, revenueModel: r.revenue_model, revenueValue: r.revenue_value,
  goalId: r.goal_id, firePartnerPostback: r.fire_partner_postback, caps: r.caps,
  ...(singleCap(r.caps) ?? { capType: null, capInterval: null, capValue: null }),
  conversionStatus: r.conversion_status, throttleRate: r.throttle_rate, setParameterGoal: r.set_parameter_goal,
  landingPageUrl: r.landing_page_url, creativeType: r.creative_type, creativeUrl: r.creative_url,
  creativeThumbnailUrl: r.creative_thumbnail_url, emailFrom: r.email_from, emailSubject: r.email_subject,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const capWindow = z.object(Object.fromEntries(CAP_INTERVALS.map((i) => [i, z.number().positive().optional()]))).strict();
const capsSchema = z.object(Object.fromEntries(CAP_KINDS.map((k) => [k, capWindow.optional()]))).strict();
const values = z.array(z.string().trim().min(1).max(100)).max(500);
const targetingSchema = z.object({ countries: values.optional(), devices: values.optional(), os: values.optional(), browsers: values.optional() }).strict();
const httpUrl = z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL');
const when = z.coerce.date();
const text = (max: number) => z.string().max(max).nullable().optional();

const fields = {
  category: z.enum(CATEGORIES),
  offerId: z.string().uuid(),
  name: text(200),
  partnerId: z.string().uuid().nullable().optional(),
  partnerIds: z.array(z.string().uuid()).max(5000).optional(),
  applyAllPartners: z.boolean().optional(),
  description: text(4000),
  publicDescription: text(4000),
  status: z.enum(['active', 'inactive']),
  effectiveFrom: when.nullable().optional(),
  effectiveTo: when.nullable().optional(),
  targeting: targetingSchema.optional(),
  applyCustomPayout: z.boolean().optional(),
  payoutModel: z.enum(MODELS).nullable().optional(),
  payoutValue: moneySchema.nullable().optional(),
  applyCustomRevenue: z.boolean().optional(),
  revenueModel: z.enum(MODELS).nullable().optional(),
  revenueValue: moneySchema.nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  firePartnerPostback: z.boolean().optional(),
  caps: capsSchema.optional(),
  capType: z.enum(CAP_KINDS).optional(),
  capInterval: z.enum(CAP_INTERVALS).optional(),
  capValue: z.coerce.number().positive().optional(),
  conversionStatus: z.enum(['rejected', 'pending']).nullable().optional(),
  throttleRate: z.coerce.number().gt(0).max(100).nullable().optional(),
  setParameterGoal: z.boolean().optional(),
  landingPageUrl: httpUrl.nullable().optional(),
  creativeType: z.enum(CREATIVE_TYPES).nullable().optional(),
  creativeUrl: httpUrl.nullable().optional(),
  creativeThumbnailUrl: httpUrl.nullable().optional(),
  emailFrom: text(200),
  emailSubject: text(500),
};
const createSchema = z.object({ ...fields, status: fields.status.default('active') });
const updateSchema = z.object(fields).partial();
type Body = z.infer<typeof updateSchema>;

/** Body → columns (only the fields that were sent). The flat cap fields become the row's `caps`. */
function toColumns(b: Body): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const set = (col: string, v: unknown) => { if (v !== undefined) c[col] = v; };
  set('category', b.category);
  set('offer_id', b.offerId);
  set('name', b.name);
  set('partner_id', b.partnerId);
  if (b.partnerIds !== undefined) c['partner_ids'] = JSON.stringify(b.partnerIds);
  set('apply_all_partners', b.applyAllPartners);
  set('description', b.description);
  set('public_description', b.publicDescription);
  set('status', b.status);
  set('effective_from', b.effectiveFrom);
  set('effective_to', b.effectiveTo);
  if (b.targeting !== undefined) c['targeting'] = JSON.stringify(b.targeting);
  set('apply_custom_payout', b.applyCustomPayout);
  set('payout_model', b.payoutModel);
  set('payout_value', b.payoutValue);
  set('apply_custom_revenue', b.applyCustomRevenue);
  set('revenue_model', b.revenueModel);
  set('revenue_value', b.revenueValue);
  set('goal_id', b.goalId);
  set('fire_partner_postback', b.firePartnerPostback);
  if (b.capType !== undefined || b.capValue !== undefined) {
    if (!b.capType || !b.capValue) throw badRequest('capType and capValue go together (capInterval defaults to daily).');
    c['caps'] = JSON.stringify({ [b.capType]: { [b.capInterval ?? 'daily']: b.capValue } });
  } else if (b.caps !== undefined) c['caps'] = JSON.stringify(b.caps);
  set('conversion_status', b.conversionStatus);
  set('throttle_rate', b.throttleRate);
  set('set_parameter_goal', b.setParameterGoal);
  set('landing_page_url', b.landingPageUrl);
  set('creative_type', b.creativeType);
  set('creative_url', b.creativeUrl);
  set('creative_thumbnail_url', b.creativeThumbnailUrl);
  set('email_from', b.emailFrom);
  set('email_subject', b.emailSubject);
  return c;
}

/**
 * Fill derived defaults and check the row as it will be stored (create: the body; update: the
 * existing row + patch): what each category must carry, the effective window, and that partners and
 * the goal belong here. 400 with a clear message — never a DB 500.
 */
async function finalize(networkId: string, cols: Record<string, unknown>, before: Row | null): Promise<void> {
  const v = <T>(col: string): T => (col in cols ? cols[col] : (before as unknown as Record<string, unknown> | null)?.[col]) as T;
  const parsedJson = <T>(col: string, dflt: T): T => {
    const raw = v<unknown>(col);
    return raw == null ? dflt : (typeof raw === 'string' ? JSON.parse(raw) as T : raw as T);
  };
  const partnerId = v<string | null>('partner_id');
  const partnerIds = parsedJson<string[]>('partner_ids', []);
  if (!('apply_all_partners' in cols) && ('partner_id' in cols || 'partner_ids' in cols || !before)) {
    cols['apply_all_partners'] = !partnerId && partnerIds.length === 0;
  }
  if (!('apply_custom_payout' in cols) && 'payout_value' in cols) cols['apply_custom_payout'] = cols['payout_value'] != null;
  if (!('apply_custom_revenue' in cols) && 'revenue_value' in cols) cols['apply_custom_revenue'] = cols['revenue_value'] != null;

  const category = v<string>('category');
  const offerId = v<string>('offer_id');
  if (category === 'revenue_payout') {
    const payout = v<boolean>('apply_custom_payout') && v<string | null>('payout_value') != null;
    const revenue = v<boolean>('apply_custom_revenue') && v<string | null>('revenue_value') != null;
    if (!payout && !revenue) throw badRequest('A Revenue & Payout setting needs a custom payout or revenue value.');
  } else if (category === 'caps') {
    const caps = parsedJson<CapsMatrix>('caps', {});
    if (!CAP_KINDS.some((k) => capLimits(caps, k).length)) throw badRequest('A Caps setting needs at least one cap (e.g. capType + capValue).');
  } else if (category === 'throttle_rates') {
    if (v<number | string | null>('throttle_rate') == null) throw badRequest('A Throttle Rates setting needs a throttleRate (0–100).');
  } else if (category === 'landing_pages') {
    if (!v<string | null>('landing_page_url')) throw badRequest('A Landing Pages setting needs a landingPageUrl.');
  }
  const from = v<Date | string | null>('effective_from');
  const to = v<Date | string | null>('effective_to');
  if (from && to && new Date(from) >= new Date(to)) throw badRequest('effectiveFrom must be before effectiveTo.');

  await assertSameNetwork(networkId, 'offers', offerId, 'offerId');
  await assertSameNetwork(networkId, 'publishers', partnerId, 'partnerId');
  await assertAllSameNetwork(networkId, 'publishers', partnerIds, 'partnerIds');
  const goalId = v<string | null>('goal_id');
  if (goalId) {
    const { rows } = await query('SELECT 1 FROM offer_goals WHERE network_id = $1 AND offer_id = $2 AND id = $3', [networkId, offerId, goalId]);
    if (!rows.length) throw badRequest('goalId must be a goal of this offer.');
  }
}

export function offerCustomSettingsRoutes(): Router {
  const r = Router();
  rejectMalformedIdParams(r, 'id');

  const listQuery = z.object({ category: z.enum(CATEGORIES).optional(), offerId: z.string().uuid().optional() });
  r.get('/', validateQuery(listQuery), asyncHandler(async (req, res) => {
    const { category, offerId } = res.locals.query as z.infer<typeof listQuery>;
    const where: Record<string, unknown> = {};
    if (category) where['category'] = category;
    if (offerId) where['offer_id'] = offerId;
    const rows = await dbForRequest(req).selectMany<Row>(TABLE, { where, orderBy: 'created_at', limit: LIST_CAP, maxLimit: LIST_CAP });
    warnIfCapped(rows, LIST_CAP, 'offer-custom-settings.list');
    sendOk(res, rows.filter((row) => row.status !== 'deleted').map(dto));
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const row = await dbForRequest(req).selectOne<Row>(TABLE, { id: req.params.id });
    if (!row || row.status === 'deleted') throw notFound('Custom setting not found');
    sendOk(res, dto(row));
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const cols = toColumns(req.body as Body);
    await finalize(db.scope.networkId, cols, null);
    const row = await db.insert<Row>(TABLE, cols);
    await invalidateOfferConfig(db.scope.networkId, row.offer_id);
    await writeAudit(req, { action: 'offer_custom_setting.create', entityType: 'offer_custom_setting', entityId: row.id, after: row });
    sendOk(res, dto(row), undefined, 201);
  }));

  r.patch('/:id', requireRole('admin', 'manager'), validateBody(updateSchema), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before || before.status === 'deleted') throw notFound('Custom setting not found');
    const cols = toColumns(req.body as Body);
    if (!Object.keys(cols).length) return sendOk(res, dto(before));
    await finalize(db.scope.networkId, cols, before);
    const [row] = await db.update<Row>(TABLE, cols, { id: before.id });
    await invalidateOfferConfig(db.scope.networkId, before.offer_id);
    if (row && row.offer_id !== before.offer_id) await invalidateOfferConfig(db.scope.networkId, row.offer_id);
    await writeAudit(req, { action: 'offer_custom_setting.update', entityType: 'offer_custom_setting', entityId: before.id, before, after: row });
    sendOk(res, dto(row ?? before));
  }));

  r.delete('/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const before = await db.selectOne<Row>(TABLE, { id: req.params.id });
    if (!before) throw notFound('Custom setting not found');
    await db.delete(TABLE, { id: before.id });
    await invalidateOfferConfig(db.scope.networkId, before.offer_id);
    await writeAudit(req, { action: 'offer_custom_setting.delete', entityType: 'offer_custom_setting', entityId: before.id, before });
    sendOk(res, { deleted: true });
  }));

  return r;
}

/**
 * Control Center — unified API for all 8 tabs (Accounts extras, Platform config, Partners,
 * Advertisers, Security lists, Usage, Documents, Segmentations).
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { query } from '../../../lib/db/pool.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';
import { getSupabaseAdmin } from '../../../lib/supabase.js';
import {
  getControlCenterConfig,
  putControlCenterConfig,
  getFullControlCenterConfig,
  loadNetworkSettings,
  type ConfigSection,
} from './config.js';

const CONFIG_SECTIONS = ['platform', 'partners', 'advertisers', 'security'] as const;

export interface UserRow {
  id: string; ref: string; name: string | null; email: string; role: string; status: string;
  metadata: Record<string, unknown> | string; created_at: string; updated_at: string;
}

function parseMeta(v: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof v === 'string') { try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; } }
  return v ?? {};
}

const userDto = (r: UserRow) => {
  const m = parseMeta(r.metadata);
  return {
    id: r.id,
    ref: Number(r.ref),
    name: r.name ?? r.email,
    email: r.email,
    role: r.role,
    status: r.status,
    businessUnit: (m['businessUnit'] as string) ?? null,
    partnerManager: Boolean(m['partnerManager']),
    advertiserManager: Boolean(m['advertiserManager']),
    primaryPhone: (m['primaryPhone'] as string) ?? null,
    title: (m['title'] as string) ?? null,
    superUser: Boolean(m['superUser']),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

const statusListQuery = z.object({
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional(),
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(['admin', 'manager', 'finance', 'read_only']).default('read_only'),
  businessUnit: z.string().max(120).optional(),
  partnerManager: z.boolean().optional(),
  advertiserManager: z.boolean().optional(),
  primaryPhone: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  superUser: z.boolean().optional(),
});

const updateUserSchema = createUserSchema.partial().extend({
  status: z.enum(['active', 'invited', 'disabled']).optional(),
});

export function controlCenterRoutes(): Router {
  const r = Router();

  // --- Config blobs (platform / partners / advertisers / security MFA) ---
  r.get('/config', asyncHandler(async (req, res) => {
    sendOk(res, await getFullControlCenterConfig(req.scope!.networkId));
  }));

  r.get('/config/:section', asyncHandler(async (req, res) => {
    const section = req.params.section as ConfigSection;
    if (!CONFIG_SECTIONS.includes(section as typeof CONFIG_SECTIONS[number])) throw badRequest('Invalid section');
    const settings = await loadNetworkSettings(req.scope!.networkId);
    sendOk(res, getControlCenterConfig(settings, section));
  }));

  r.put(
    '/config/:section',
    requireRole('admin', 'manager'),
    validateBody(z.record(z.string(), z.unknown())),
    asyncHandler(async (req, res) => {
      const section = req.params.section as ConfigSection;
      if (!CONFIG_SECTIONS.includes(section as typeof CONFIG_SECTIONS[number])) throw badRequest('Invalid section');
      const merged = await putControlCenterConfig(req.scope!.networkId, section, req.body as Record<string, unknown>);
      await writeAudit(req, { action: 'control_center.config.update', entityType: 'network', entityId: req.scope!.networkId, after: { section } });
      sendOk(res, merged);
    }),
  );

  // --- Accounts: extended user CRUD ---
  r.post(
    '/users',
    requireRole('admin'),
    validateBody(createUserSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const b = req.body as z.infer<typeof createUserSchema>;
      const networkId = req.scope!.networkId;
      const metadata = {
        businessUnit: b.businessUnit ?? null,
        partnerManager: b.partnerManager ?? false,
        advertiserManager: b.advertiserManager ?? false,
        primaryPhone: b.primaryPhone ?? null,
        title: b.title ?? null,
        superUser: b.superUser ?? false,
      };
      const tempPassword = `Tmp${Math.random().toString(36).slice(2)}!9Aa`;
      const sb = getSupabaseAdmin();
      const { data: authData, error } = await sb.auth.admin.createUser({
        email: b.email,
        password: tempPassword,
        email_confirm: true,
        app_metadata: { kind: 'admin', network_id: networkId, role: b.role },
        user_metadata: { name: b.name },
      });
      if (error || !authData.user) throw badRequest(error?.message ?? 'Failed to create auth user');
      const row = await db.insert<UserRow>('users', {
        auth_user_id: authData.user.id,
        email: b.email,
        name: b.name,
        role: b.role,
        status: 'invited',
        metadata: JSON.stringify(metadata),
      });
      await writeAudit(req, { action: 'user.create', entityType: 'users', entityId: row.id, after: row });
      res.status(201);
      sendOk(res, userDto(row));
    }),
  );

  r.patch(
    '/users/:id',
    requireRole('admin'),
    validateBody(updateUserSchema),
    asyncHandler(async (req, res) => {
      const db = dbForRequest(req);
      const id = req.params.id ?? '';
      const before = await db.selectOne<UserRow>('users', { id });
      if (!before) throw notFound('User not found');
      const b = req.body as z.infer<typeof updateUserSchema>;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch['name'] = b.name;
      if (b.role !== undefined) patch['role'] = b.role;
      if (b.status !== undefined) patch['status'] = b.status;
      const meta = parseMeta(before.metadata);
      for (const k of ['businessUnit', 'partnerManager', 'advertiserManager', 'primaryPhone', 'title', 'superUser'] as const) {
        if (b[k] !== undefined) meta[k === 'businessUnit' ? 'businessUnit' : k] = b[k];
      }
      patch['metadata'] = JSON.stringify(meta);
      const [updated] = await db.update<UserRow>('users', patch, { id });
      await writeAudit(req, { action: 'user.update', entityType: 'users', entityId: id, before, after: updated });
      sendOk(res, userDto(updated ?? before));
    }),
  );

  // --- Usage (monthly impressions + marketplace pulls) ---
  r.get('/usage', validateQuery(z.object({ year: z.coerce.number().optional() })), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const year = Number(req.query.year) || new Date().getFullYear();
    const { rows } = await query<{ month: string; total: string }>(
      `SELECT to_char(period_date, 'YYYY-MM') AS month, SUM(value)::bigint AS total
       FROM usage_records
       WHERE network_id = $1 AND metric = 'clicks' AND EXTRACT(YEAR FROM period_date) = $2
       GROUP BY 1 ORDER BY 1`,
      [networkId, year],
    );
    const settings = await loadNetworkSettings(networkId);
    const integrations = (settings['integrations'] as Record<string, unknown> | undefined) ?? {};
    const offersPulledMonth = Number(integrations['offerFeedPulledMonth'] ?? 0);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const byMonth = new Map(rows.map((row) => [row.month, Number(row.total)]));
    const now = new Date();
    const data = monthNames.map((label, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const isCurrent = now.getFullYear() === year && now.getMonth() === i;
      return {
        month: label,
        impressions: byMonth.get(key) ?? 0,
        offersPulled: isCurrent ? offersPulledMonth : 0,
      };
    });
    sendOk(res, { year, rows: data });
  }));

  // --- Documents ---
  crudRoutes(r, 'documents', 'network_documents', {
    create: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(2000).default(''),
      fileUrl: z.string().max(2000).default(''),
      status: z.enum(['active', 'inactive']).default('active'),
    }),
    toDto: (row: Record<string, unknown>) => ({
      id: row['id'],
      ref: Number(row['ref']),
      name: row['name'],
      description: row['description'],
      fileUrl: row['file_url'],
      status: row['status'],
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
    }),
    toInsert: (b: Record<string, unknown>) => ({
      name: b['name'],
      description: b['description'] ?? '',
      file_url: b['fileUrl'] ?? '',
      status: b['status'] ?? 'active',
    }),
  });

  // --- Segmentations ---
  crudRoutes(r, 'categories', 'segmentation_categories', {
    create: z.object({ name: z.string().min(1).max(120), status: z.enum(['active', 'inactive']).default('active') }),
    toDto: segDto,
    toInsert: (b) => ({ name: b['name'], status: b['status'] ?? 'active' }),
  });

  crudRoutes(r, 'channels', 'segmentation_channels', {
    create: z.object({ name: z.string().min(1).max(120), status: z.enum(['active', 'inactive']).default('active') }),
    toDto: segDto,
    toInsert: (b) => ({ name: b['name'], status: b['status'] ?? 'active' }),
  });

  crudRoutes(r, 'business-units', 'business_units', {
    create: z.object({ name: z.string().min(1).max(120), status: z.enum(['active', 'inactive']).default('active') }),
    toDto: (row) => ({ id: row['id'], name: row['name'], status: row['status'], createdAt: row['created_at'], updatedAt: row['updated_at'] }),
    toInsert: (b) => ({ name: b['name'], status: b['status'] ?? 'active' }),
  });

  // --- Security lists ---
  r.get('/api-whitelist', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<{ id: string; ip_address: string; created_at: string }>('network_api_whitelist', { where: {}, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map((row) => ({ id: row.id, ipAddress: row.ip_address, createdAt: row.created_at })));
  }));

  r.post('/api-whitelist', requireRole('admin'), validateBody(z.object({ ipAddress: z.string().min(1).max(100) })), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as { ipAddress: string };
    const row = await db.insert('network_api_whitelist', { ip_address: b.ipAddress });
    res.status(201);
    sendOk(res, { id: row.id, ipAddress: b.ipAddress, createdAt: row.created_at });
  }));

  r.delete('/api-whitelist/:id', requireRole('admin'), asyncHandler(async (req, res) => {
    const n = await dbForRequest(req).delete('network_api_whitelist', { id: req.params.id });
    if (n === 0) throw notFound('Entry not found');
    sendOk(res, { deleted: true });
  }));

  r.get('/ip-blacklist', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<{ id: string; ip_from: string; ip_to: string }>('network_ip_blacklist', { where: {}, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map((row) => ({ id: row.id, from: row.ip_from, to: row.ip_to || row.ip_from })));
  }));

  r.put('/ip-blacklist', requireRole('admin', 'manager'), validateBody(z.object({
    ranges: z.array(z.object({ from: z.string().min(1), to: z.string().optional() })),
  })), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as { ranges: { from: string; to?: string }[] };
    await db.delete('network_ip_blacklist', {});
    const out = [];
    for (const range of b.ranges) {
      const row = await db.insert<{ id: string; ip_from: string; ip_to: string }>('network_ip_blacklist', {
        ip_from: range.from,
        ip_to: range.to ?? range.from,
      });
      out.push({ id: row.id, from: row.ip_from, to: row.ip_to });
    }
    sendOk(res, out);
  }));

  r.get('/login-events', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Record<string, unknown>>('login_events', { where: {}, orderBy: 'created_at', orderDir: 'desc', limit: 500 });
    sendOk(res, rows.map(loginDto));
  }));

  // --- Domain managers ---
  crudRoutes(r, 'domain-managers', 'network_domain_managers', {
    create: z.object({
      firstName: z.string().min(1).max(80),
      lastName: z.string().max(80).default(''),
      email: z.string().email(),
      status: z.enum(['active', 'inactive']).default('active'),
    }),
    toDto: (row) => ({
      id: row['id'],
      firstName: row['first_name'],
      lastName: row['last_name'],
      email: row['email'],
      status: row['status'],
      createdAt: row['created_at'],
      updatedAt: row['updated_at'],
    }),
    toInsert: (b) => ({
      first_name: b['firstName'],
      last_name: b['lastName'] ?? '',
      email: b['email'],
      status: b['status'] ?? 'active',
    }),
  });

  // --- Partner referral overrides ---
  r.get('/partner-referrals', validateQuery(statusListQuery), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const status = (req.query.status as string | undefined) ?? 'all';
    const where = status === 'all' ? {} : { status };
    const rows = await db.selectMany<Record<string, unknown>>('partner_referral_overrides', { where, orderBy: 'created_at', limit: 500 });
    sendOk(res, rows.map(referralDto));
  }));

  r.post('/partner-referrals', requireRole('admin', 'manager'), validateBody(z.object({
    publisherId: z.string().uuid().optional(),
    enabled: z.boolean().default(true),
    commissionStructure: z.string().default(''),
    fixedAmountRate: z.string().default(''),
    minimumThreshold: z.string().default(''),
    duration: z.string().default(''),
  })), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as Record<string, unknown>;
    const row = await db.insert('partner_referral_overrides', {
      publisher_id: b['publisherId'] ?? null,
      enabled: b['enabled'],
      commission_structure: b['commissionStructure'] ?? '',
      fixed_amount_rate: b['fixedAmountRate'] ?? '',
      minimum_threshold: b['minimumThreshold'] ?? '',
      duration: b['duration'] ?? '',
      status: 'active',
    });
    res.status(201);
    sendOk(res, referralDto(row));
  }));

  r.delete('/partner-referrals/:id', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const [updated] = await db.update('partner_referral_overrides', { status: 'deleted' }, { id: req.params.id });
    if (!updated) throw notFound('Not found');
    sendOk(res, { deleted: true });
  }));

  // --- Terms acceptances ---
  r.get('/terms-acceptances', asyncHandler(async (req, res) => {
    const rows = await dbForRequest(req).selectMany<Record<string, unknown>>('terms_acceptances', { where: {}, orderBy: 'created_at', orderDir: 'desc', limit: 500 });
    sendOk(res, rows.map(termsDto));
  }));

  r.post('/terms-acceptances', requireRole('admin', 'manager'), validateBody(z.object({
    publisherId: z.string().uuid().optional(),
    partnerUser: z.string().default(''),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
  })), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const b = req.body as Record<string, unknown>;
    const row = await db.insert('terms_acceptances', {
      publisher_id: b['publisherId'] ?? null,
      partner_user: b['partnerUser'] ?? '',
      user_agent: b['userAgent'] ?? null,
      ip_address: b['ipAddress'] ?? null,
    });
    res.status(201);
    sendOk(res, termsDto(row));
  }));

  // --- Tags with usage counts (Segmentations › Labels) ---
  r.get('/tags-with-usage', asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const networkId = req.scope!.networkId;
    const tags = await db.selectMany<{ id: string; name: string; color: string | null; created_at: string }>('tags', { where: {}, orderBy: 'name', limit: 1000 });
    const { rows: counts } = await query<{ tag_id: string; entity_type: string; c: string }>(
      `SELECT tag_id, entity_type, COUNT(*)::text AS c FROM taggings WHERE network_id = $1 GROUP BY tag_id, entity_type`,
      [networkId],
    );
    const byTag = new Map<string, Record<string, number>>();
    for (const row of counts) {
      const m = byTag.get(row.tag_id) ?? {};
      m[row.entity_type] = Number(row.c);
      byTag.set(row.tag_id, m);
    }
    sendOk(res, tags.map((t) => {
      const c = byTag.get(t.id) ?? {};
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        createdAt: t.created_at,
        advertisers: c['advertiser'] ?? 0,
        partners: c['publisher'] ?? 0,
        offers: c['offer'] ?? 0,
        partnerTiers: c['partner_tier'] ?? 0,
        smartLinks: 0,
        offerGroups: 0,
      };
    }));
  }));

  return r;
}

function segDto(row: Record<string, unknown>) {
  return {
    id: row['id'],
    ref: row['ref'] != null ? Number(row['ref']) : null,
    name: row['name'],
    status: row['status'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  };
}

function referralDto(row: Record<string, unknown>) {
  return {
    id: row['id'],
    ref: row['ref'] != null ? Number(row['ref']) : null,
    publisherId: row['publisher_id'],
    enabled: row['enabled'],
    commissionStructure: row['commission_structure'],
    fixedAmountRate: row['fixed_amount_rate'],
    minimumThreshold: row['minimum_threshold'],
    duration: row['duration'],
    status: row['status'],
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
  };
}

function termsDto(row: Record<string, unknown>) {
  return {
    id: row['id'],
    publisherId: row['publisher_id'],
    partnerUser: row['partner_user'],
    userAgent: row['user_agent'],
    ipAddress: row['ip_address'],
    createdAt: row['created_at'],
  };
}

function loginDto(row: Record<string, unknown>) {
  return {
    id: row['id'],
    employee: row['employee_name'] ?? row['employee_email'] ?? '—',
    ip: row['ip'],
    country: row['country'],
    city: row['city'],
    userAgent: row['user_agent'],
    platform: row['platform'],
    deviceType: row['device_type'],
    osVersion: row['os_version'],
    browser: row['browser'],
    existingDevice: row['existing_device'],
    createdAt: row['created_at'],
  };
}

function crudRoutes(
  r: Router,
  path: string,
  table: string,
  spec: {
    create: z.ZodType;
    toDto: (row: Record<string, unknown>) => unknown;
    toInsert: (body: Record<string, unknown>) => Record<string, unknown>;
  },
): void {
  r.get(`/${path}`, validateQuery(statusListQuery), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const status = (req.query.status as string | undefined) ?? 'all';
    const where = status === 'all' ? {} : { status };
    const rows = await db.selectMany<Record<string, unknown>>(table, { where, orderBy: 'created_at', orderDir: 'desc', limit: 500 });
    sendOk(res, rows.map(spec.toDto));
  }));

  r.post(`/${path}`, requireRole('admin', 'manager'), validateBody(spec.create), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const row = await db.insert<Record<string, unknown>>(table, spec.toInsert(req.body as Record<string, unknown>));
    await writeAudit(req, { action: `control_center.${path}.create`, entityType: table, entityId: String(row['id']), after: row });
    res.status(201);
    sendOk(res, spec.toDto(row));
  }));

  r.delete(`/${path}/:id`, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const db = dbForRequest(req);
    const [updated] = await db.update(table, { status: 'deleted' }, { id: req.params.id });
    if (!updated) throw notFound('Not found');
    sendOk(res, { deleted: true });
  }));
}

/** Record a dashboard login for Control Center › Security › Logins. */
export async function recordLoginEvent(opts: {
  networkId: string | null;
  userId: string | null;
  employeeName: string | null;
  employeeEmail: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO login_events (network_id, user_id, employee_name, employee_email, ip, user_agent, platform, device_type, browser)
     VALUES ($1, $2, $3, $4, $5, $6, 'Web', 'Desktop', 'Browser')`,
    [opts.networkId, opts.userId, opts.employeeName, opts.employeeEmail, opts.ip, opts.userAgent],
  );
}

export { userDto };

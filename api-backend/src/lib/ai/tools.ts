/**
 * AI ops tools (spec §11) — the ONLY way the model touches data. Every tool is READ-ONLY and
 * TENANT-SCOPED: each executor is handed the caller's network_id and can never query another
 * network (non-negotiable #5, §11 hard rules). No tool mutates anything — the AI reads freely and
 * proposes changes as text for a human to approve. run_report reuses the SAME reporting provider
 * as /api/reports, so the AI's numbers are identical to the dashboard's — it cannot hallucinate
 * figures for tool-returned data (spec §11 acceptance).
 */
import type { Anthropic } from '@anthropic-ai/sdk';
import { query } from '../db/pool.js';
import { ScopedDb } from '../db/scoped-db.js';
import { getReportingProvider } from '../reporting/index.js';
import { buildReportRequest } from '../reporting/request.js';

export interface ToolContext {
  networkId: string;
}

export interface AiTool {
  definition: Anthropic.Tool;
  execute: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export const AI_TOOLS: AiTool[] = [
  {
    definition: {
      name: 'run_report',
      description:
        'Run a tenant-scoped analytics report over clicks and conversions. Returns exact numbers ' +
        '(same as the dashboard reporting API). Use this for any question about clicks, conversions, ' +
        'conversion rate, payout, revenue, margin, or EPC — never estimate these yourself.',
      input_schema: {
        type: 'object',
        properties: {
          groupBy: { type: 'string', description: 'Comma-separated dimensions: offer, publisher, advertiser, country, device, day, hour, sub1-5' },
          metrics: { type: 'string', description: 'Comma-separated metrics: clicks, unique_clicks, conversions, cr, payout, revenue, margin, epc' },
          from: { type: 'string', description: 'ISO datetime lower bound (inclusive)' },
          to: { type: 'string', description: 'ISO datetime upper bound (inclusive)' },
          offerId: { type: 'string' }, publisherId: { type: 'string' }, advertiserId: { type: 'string' },
          country: { type: 'string' }, device: { type: 'string' },
          limit: { type: 'integer', description: 'Max rows (default 50, max 200)' },
        },
      },
    },
    async execute(ctx, input) {
      const req = buildReportRequest(ctx.networkId, {
        groupBy: str(input['groupBy']), metrics: str(input['metrics']),
        from: str(input['from']), to: str(input['to']),
        offerId: str(input['offerId']), publisherId: str(input['publisherId']), advertiserId: str(input['advertiserId']),
        country: str(input['country']), device: str(input['device']),
        limit: typeof input['limit'] === 'number' ? input['limit'] : 50, offset: 0,
      }, 'admin');
      return getReportingProvider().runReport(req);
    },
  },
  {
    definition: {
      name: 'list_alerts',
      description: 'List fraud/anomaly alerts for the network. Use for anomaly triage. Filter by status (open, acknowledged, resolved).',
      input_schema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] } },
      },
    },
    async execute(ctx, input) {
      const where = str(input['status']) ? { status: str(input['status']) } : {};
      return ScopedDb.forNetwork(ctx.networkId).selectMany('alerts', { where, orderBy: 'created_at', limit: 50 });
    },
  },
  {
    definition: {
      name: 'list_offers',
      description: 'List the network\'s offers with status, payout model, default payout and revenue.',
      input_schema: { type: 'object', properties: { limit: { type: 'integer' } } },
    },
    async execute(ctx, input) {
      const limit = typeof input['limit'] === 'number' ? Math.min(input['limit'], 200) : 100;
      return ScopedDb.forNetwork(ctx.networkId).selectMany('offers', { orderBy: 'created_at', limit });
    },
  },
  {
    definition: {
      name: 'list_publishers',
      description: 'List the network\'s publishers with status and traffic source.',
      input_schema: { type: 'object', properties: { limit: { type: 'integer' } } },
    },
    async execute(ctx, input) {
      const limit = typeof input['limit'] === 'number' ? Math.min(input['limit'], 200) : 100;
      return ScopedDb.forNetwork(ctx.networkId).selectMany('publishers', { orderBy: 'created_at', limit });
    },
  },
  {
    definition: {
      name: 'list_advertisers',
      description: 'List the network\'s advertisers with status.',
      input_schema: { type: 'object', properties: { limit: { type: 'integer' } } },
    },
    async execute(ctx, input) {
      const limit = typeof input['limit'] === 'number' ? Math.min(input['limit'], 200) : 100;
      return ScopedDb.forNetwork(ctx.networkId).selectMany('advertisers', { orderBy: 'created_at', limit });
    },
  },
  {
    definition: {
      name: 'network_summary',
      description: 'Get a 30-day summary for the whole network: clicks, approved conversions, revenue, payout, margin.',
      input_schema: { type: 'object', properties: {} },
    },
    async execute(ctx) {
      const clicks = (await query<{ n: string }>(
        `SELECT COUNT(*)::text n FROM clicks WHERE network_id = $1 AND created_at >= now() - interval '30 days'`,
        [ctx.networkId],
      )).rows[0]!.n;
      const c = (await query<{ n: string; payout: string; revenue: string }>(
        `SELECT COUNT(*)::text n, COALESCE(SUM(payout),0)::text payout, COALESCE(SUM(revenue),0)::text revenue
           FROM conversions WHERE network_id = $1 AND status = 'approved' AND created_at >= now() - interval '30 days'`,
        [ctx.networkId],
      )).rows[0]!;
      return {
        windowDays: 30, clicks: Number(clicks), conversions: Number(c.n),
        revenue: c.revenue, payout: c.payout,
        margin: (Number(c.revenue) - Number(c.payout)).toFixed(4),
      };
    },
  },
];

export const toolByName = new Map(AI_TOOLS.map((t) => [t.definition.name, t]));

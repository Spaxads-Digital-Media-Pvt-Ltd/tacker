/**
 * Investigator query engine — matches real clicks/conversions by sub ID, transaction ID,
 * click ID, or partner within a saved date range. No fabricated rows.
 */
import { query } from '../db/pool.js';

export type InvestigationTargetType = 'sub_id' | 'transaction_id' | 'click_id' | 'partner';

export interface InvestigationQueryInput {
  networkId: string;
  startDate: string;
  endDate: string;
  targetType: InvestigationTargetType;
  targetValue?: string | null;
  subField?: string | null;
  publisherId?: string | null;
}

export interface InvestigationStats {
  entryCount: number;
  suspectCount: number;
  offerCount: number;
  partnerCount: number;
}

export interface InvestigationReportEntry {
  id: string;
  entryType: 'click' | 'conversion';
  clickId: string;
  conversionId: string | null;
  offerId: string;
  offerName: string | null;
  offerRef: number | null;
  publisherId: string | null;
  publisherName: string | null;
  publisherRef: number | null;
  createdAt: string;
  country: string | null;
  sub1: string | null;
  sub2: string | null;
  transactionId: string | null;
  eventName: string | null;
  status: string | null;
  payout: number | null;
  revenue: number | null;
}

function normalizeDate(d: string | Date): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function dateRange(startDate: string, endDate: string): { from: string; to: string } {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  return {
    from: `${start}T00:00:00.000Z`,
    to: `${end}T23:59:59.999Z`,
  };
}

async function clickIdsForInput(input: InvestigationQueryInput): Promise<string[]> {
  const { networkId, startDate, endDate, targetType, targetValue, subField, publisherId } = input;
  const { from, to } = dateRange(startDate, endDate);

  if (targetType === 'click_id') {
    const { rows } = await query<{ click_id: string }>(
      `SELECT click_id FROM clicks
       WHERE network_id = $1 AND click_id = $2 AND created_at >= $3 AND created_at <= $4
       LIMIT 1`,
      [networkId, targetValue, from, to],
    );
    return rows.map((r) => r.click_id);
  }

  if (targetType === 'transaction_id') {
    const { rows } = await query<{ click_id: string }>(
      `SELECT click_id FROM conversions
       WHERE network_id = $1 AND transaction_id = $2 AND created_at >= $3 AND created_at <= $4`,
      [networkId, targetValue, from, to],
    );
    return [...new Set(rows.map((r) => r.click_id))];
  }

  if (targetType === 'partner') {
    const { rows } = await query<{ click_id: string }>(
      `SELECT click_id FROM clicks
       WHERE network_id = $1 AND publisher_id = $2 AND created_at >= $3 AND created_at <= $4`,
      [networkId, publisherId, from, to],
    );
    return rows.map((r) => r.click_id);
  }

  const field = subField ?? 'sub1';
  if (!['sub1', 'sub2', 'sub3', 'sub4', 'sub5'].includes(field)) {
    throw new Error(`Invalid sub field: ${field}`);
  }
  const { rows } = await query<{ click_id: string }>(
    `SELECT click_id FROM clicks
     WHERE network_id = $1 AND ${field} = $2 AND created_at >= $3 AND created_at <= $4`,
    [networkId, targetValue, from, to],
  );
  return rows.map((r) => r.click_id);
}

export async function runInvestigationReport(input: InvestigationQueryInput): Promise<InvestigationReportEntry[]> {
  const clickIds = await clickIdsForInput(input);
  if (clickIds.length === 0) return [];

  const { networkId, startDate, endDate } = input;
  const { from, to } = dateRange(startDate, endDate);

  const [clicks, conversions] = await Promise.all([
    query<{
      id: string; click_id: string; offer_id: string; publisher_id: string | null;
      created_at: string; country: string | null; sub1: string | null; sub2: string | null;
      offer_name: string | null; offer_ref: string | null;
      publisher_name: string | null; publisher_ref: string | null;
    }>(
      `SELECT c.id, c.click_id, c.offer_id, c.publisher_id, c.created_at, c.country, c.sub1, c.sub2,
              o.name AS offer_name, o.ref::text AS offer_ref,
              p.name AS publisher_name, p.ref::text AS publisher_ref
       FROM clicks c
       LEFT JOIN offers o ON o.id = c.offer_id AND o.network_id = c.network_id
       LEFT JOIN publishers p ON p.id = c.publisher_id AND p.network_id = c.network_id
       WHERE c.network_id = $1 AND c.click_id = ANY($2)
         AND c.created_at >= $3 AND c.created_at <= $4
       ORDER BY c.created_at DESC
       LIMIT 500`,
      [networkId, clickIds, from, to],
    ),
    query<{
      id: string; conversion_id: string; click_id: string; offer_id: string; publisher_id: string | null;
      created_at: string; event_name: string | null; status: string; transaction_id: string | null;
      payout: string | null; revenue: string | null;
      offer_name: string | null; offer_ref: string | null;
      publisher_name: string | null; publisher_ref: string | null;
    }>(
      `SELECT conv.id, conv.conversion_id, conv.click_id, conv.offer_id, conv.publisher_id,
              conv.created_at, conv.event_name, conv.status, conv.transaction_id,
              conv.payout::text, conv.revenue::text,
              o.name AS offer_name, o.ref::text AS offer_ref,
              p.name AS publisher_name, p.ref::text AS publisher_ref
       FROM conversions conv
       LEFT JOIN offers o ON o.id = conv.offer_id AND o.network_id = conv.network_id
       LEFT JOIN publishers p ON p.id = conv.publisher_id AND p.network_id = conv.network_id
       WHERE conv.network_id = $1 AND conv.click_id = ANY($2)
         AND conv.created_at >= $3 AND conv.created_at <= $4
       ORDER BY conv.created_at DESC
       LIMIT 500`,
      [networkId, clickIds, from, to],
    ),
  ]);

  const entries: InvestigationReportEntry[] = [
    ...clicks.rows.map((c) => ({
      id: c.id,
      entryType: 'click' as const,
      clickId: c.click_id,
      conversionId: null,
      offerId: c.offer_id,
      offerName: c.offer_name,
      offerRef: c.offer_ref != null ? Number(c.offer_ref) : null,
      publisherId: c.publisher_id,
      publisherName: c.publisher_name,
      publisherRef: c.publisher_ref != null ? Number(c.publisher_ref) : null,
      createdAt: c.created_at,
      country: c.country,
      sub1: c.sub1,
      sub2: c.sub2,
      transactionId: null,
      eventName: null,
      status: null,
      payout: null,
      revenue: null,
    })),
    ...conversions.rows.map((c) => ({
      id: c.id,
      entryType: 'conversion' as const,
      clickId: c.click_id,
      conversionId: c.conversion_id,
      offerId: c.offer_id,
      offerName: c.offer_name,
      offerRef: c.offer_ref != null ? Number(c.offer_ref) : null,
      publisherId: c.publisher_id,
      publisherName: c.publisher_name,
      publisherRef: c.publisher_ref != null ? Number(c.publisher_ref) : null,
      createdAt: c.created_at,
      country: null,
      sub1: null,
      sub2: null,
      transactionId: c.transaction_id,
      eventName: c.event_name,
      status: c.status,
      payout: c.payout != null ? Number(c.payout) : null,
      revenue: c.revenue != null ? Number(c.revenue) : null,
    })),
  ];

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return entries.slice(0, 500);
}

export async function computeInvestigationStats(input: InvestigationQueryInput): Promise<InvestigationStats> {
  const entries = await runInvestigationReport(input);
  const publishers = new Set(entries.map((e) => e.publisherId).filter(Boolean));
  const offers = new Set(entries.map((e) => e.offerId));
  return {
    entryCount: entries.length,
    suspectCount: publishers.size,
    offerCount: offers.size,
    partnerCount: publishers.size,
  };
}

export function formatInvestigationTarget(row: {
  target_type: string;
  target_value: string | null;
  sub_field: string | null;
  publisher_name?: string | null;
}): string {
  if (row.target_type === 'partner') return row.publisher_name ? `Partner: ${row.publisher_name}` : 'Partner';
  if (row.target_type === 'sub_id') return `${row.sub_field ?? 'sub1'} = ${row.target_value ?? ''}`;
  if (row.target_type === 'transaction_id') return `Txn: ${row.target_value ?? ''}`;
  if (row.target_type === 'click_id') return `Click: ${row.target_value ?? ''}`;
  return row.target_value ?? '—';
}

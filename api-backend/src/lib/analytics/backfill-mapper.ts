export interface PgClickRow {
 click_id: string;
 network_id: string;
 offer_id: string;
 publisher_id: string | null;
 smart_link_id: string | null;
 created_at: string;
 ip: unknown;
 country: string | null;
 region: string | null;
 city: string | null;
 isp: string | null;
 device: string | null;
 os: string | null;
 browser: string | null;
 referrer: string | null;
 user_agent: string | null;
 sub1: string | null;
 sub2: string | null;
 sub3: string | null;
 sub4: string | null;
 sub5: string | null;
 is_unique: boolean | null;
 fraud_score: number | null;
 fraud_flags: unknown[] | null;
 resolved_payout: string | null;
 resolved_revenue: string | null;
 currency: string | null;
}

export interface PgConversionRow {
 conversion_id: string;
 network_id: string;
 click_id: string;
 offer_id: string;
 publisher_id: string | null;
 advertiser_id: string | null;
 goal_id: string | null;
 created_at: string;
 status: string;
 reason: string | null;
 source: string | null;
 event_name: string | null;
 payout: string | null;
 revenue: string | null;
 currency: string | null;
 country: string | null;
 region: string | null;
 city: string | null;
 isp: string | null;
 device: string | null;
 os: string | null;
 browser: string | null;
 sub1: string | null;
 sub2: string | null;
 sub3: string | null;
 sub4: string | null;
 sub5: string | null;
 fraud_score: number | null;
 fraud_flags: unknown[] | null;
}

export interface ClickHouseClickRow {
 click_id: string;
 network_id: string;
 offer_id: string;
 publisher_id: string | null;
 smart_link_id: string | null;
 timestamp: string;
 ip: string | null;
 country: string | null;
 region: string | null;
 city: string | null;
 isp: string | null;
 device: string | null;
 os: string | null;
 browser: string | null;
 referrer: string | null;
 user_agent: string | null;
 sub1: string | null;
 sub2: string | null;
 sub3: string | null;
 sub4: string | null;
 sub5: string | null;
 is_unique: number | null;
 fraud_score: number;
 fraud_flags: string[];
 payout: string | null;
 revenue: string | null;
 currency: string | null;
}

export interface ClickHouseConversionRow {
 conversion_id: string;
 network_id: string;
 click_id: string;
 offer_id: string;
 publisher_id: string | null;
 advertiser_id: string | null;
 goal_id: string | null;
 timestamp: string;
 status: string;
 reason: string | null;
 source: string | null;
 event_name: string | null;
 payout: string | null;
 revenue: string | null;
 currency: string | null;
 country: string | null;
 region: string | null;
 city: string | null;
 isp: string | null;
 device: string | null;
 os: string | null;
 browser: string | null;
 sub1: string | null;
 sub2: string | null;
 sub3: string | null;
 sub4: string | null;
 sub5: string | null;
 fraud_score: number;
 fraud_flags: string[];
}

export function mapPgClickToCh(row: PgClickRow): ClickHouseClickRow {
 return {
 click_id: row.click_id,
 network_id: row.network_id,
 offer_id: row.offer_id,
 publisher_id: row.publisher_id,
 smart_link_id: row.smart_link_id,
 timestamp: row.created_at,
 ip: pgIpToChIp(row.ip),
 country: row.country ?? null,
 region: row.region ?? null,
 city: row.city ?? null,
 isp: row.isp ?? null,
 device: row.device ?? null,
 os: row.os ?? null,
 browser: row.browser ?? null,
 referrer: row.referrer ?? null,
 user_agent: row.user_agent ?? null,
 sub1: row.sub1 ?? null,
 sub2: row.sub2 ?? null,
 sub3: row.sub3 ?? null,
 sub4: row.sub4 ?? null,
 sub5: row.sub5 ?? null,
 is_unique: pgBoolToUint8(row.is_unique),
 fraud_score: Math.min(Math.max(row.fraud_score ?? 0, 0), 65535),
 fraud_flags: pgArrayToChArray(row.fraud_flags),
 payout: row.resolved_payout ?? null,
 revenue: row.resolved_revenue ?? null,
 currency: row.currency ?? null,
 };
}

export function mapPgConversionToCh(row: PgConversionRow): ClickHouseConversionRow {
 return {
 conversion_id: row.conversion_id,
 network_id: row.network_id,
 click_id: row.click_id,
 offer_id: row.offer_id,
 publisher_id: row.publisher_id,
 advertiser_id: row.advertiser_id,
 goal_id: row.goal_id,
 timestamp: row.created_at,
 status: row.status,
 reason: row.reason ?? null,
 source: row.source ?? null,
 event_name: row.event_name ?? null,
 payout: row.payout ?? null,
 revenue: row.revenue ?? null,
 currency: row.currency ?? null,
 country: row.country ?? null,
 region: row.region ?? null,
 city: row.city ?? null,
 isp: row.isp ?? null,
 device: row.device ?? null,
 os: row.os ?? null,
 browser: row.browser ?? null,
 sub1: row.sub1 ?? null,
 sub2: row.sub2 ?? null,
 sub3: row.sub3 ?? null,
 sub4: row.sub4 ?? null,
 sub5: row.sub5 ?? null,
 fraud_score: Math.min(Math.max(row.fraud_score ?? 0, 0), 65535),
 fraud_flags: pgArrayToChArray(row.fraud_flags),
 };
}

function pgIpToChIp(pgIp: unknown): string | null {
 if (pgIp == null) return null;
 const s = String(pgIp);
 // ClickHouse `IPv6` column accepts both IPv4 and IPv6 strings directly.
 // No CIDR mask (PG `inet` already stripped via `host()` in the query).
 return s;
}

function pgArrayToChArray(values: unknown[] | null): string[] {
 if (!values || values.length === 0) return [];
 return values.map(v => String(v));
}

function pgBoolToUint8(val: boolean | null): number | null {
 if (val === null || val === undefined) return null;
 return val ? 1 : 0;
}

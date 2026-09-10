#!/usr/bin/env node
/**
 * Section 8: PG vs CH reporting parity on backfilled data.
 */
import { pool } from '../src/lib/db/pool';
import { getClickHouse, closeClickHouse } from '../src/lib/clickhouse/client';

const NET_A = '11111111-1111-1111-1111-111111111111';
const FROM = '2026-09-01';
const TO = '2026-09-06';

async function main() {
 const ch = getClickHouse();

 // --- Counts ---
 const pgClicks = await pool.query(
 'SELECT count(*)::int AS n FROM clicks WHERE network_id = $1 AND created_at >= $2 AND created_at < $3',
 [NET_A, FROM, TO],
 );
 const pgCvs = await pool.query(
 'SELECT count(*)::int AS n FROM conversions WHERE network_id = $1 AND created_at >= $2 AND created_at < $3',
 [NET_A, FROM, TO],
 );
 console.log(`PG clicks: ${pgClicks.rows[0].n} | conversions: ${pgCvs.rows[0].n}`);

 const chClicksQ = await ch.query({
 query: `SELECT toUInt64(count()) AS n FROM tracker.clicks FINAL
 WHERE timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
 AND network_id = {nid:UUID}`,
 query_params: { from: `${FROM} 00:00:00.000`, to: `${TO} 00:00:00.000`, nid: NET_A },
 format: 'JSONEachRow',
 });
 const chClicksRows = await chClicksQ.json<{ n: string }>();
 console.log(`CH clicks: ${chClicksRows[0]?.n}`);

 const chCvsQ = await ch.query({
 query: `SELECT toUInt64(count()) AS n FROM tracker.conversions FINAL
 WHERE timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
 AND network_id = {nid:UUID}`,
 query_params: { from: `${FROM} 00:00:00.000`, to: `${TO} 00:00:00.000`, nid: NET_A },
 format: 'JSONEachRow',
 });
 const chCvsRows = await chCvsQ.json<{ n: string }>();
 console.log(`CH conversions: ${chCvsRows[0]?.n}`);

 // --- Per-offer count parity ---
 const pgByOffer = await pool.query(
 'SELECT offer_id::text AS offer_id, count(*)::int AS n FROM clicks WHERE network_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY offer_id ORDER BY offer_id',
 [NET_A, FROM, TO],
 );
 console.log('PG clicks by offer:', JSON.stringify(pgByOffer.rows));

 const chByOfferQ = await ch.query({
 query: `SELECT toString(offer_id) AS offer_id, toUInt64(count()) AS n
 FROM tracker.clicks FINAL
 WHERE timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
 AND network_id = {nid:UUID}
 GROUP BY offer_id ORDER BY offer_id`,
 query_params: { from: `${FROM} 00:00:00.000`, to: `${TO} 00:00:00.000`, nid: NET_A },
 format: 'JSONEachRow',
 });
 const chByOfferRows = await chByOfferQ.json<{ offer_id: string; n: string }[]>();
 console.log('CH clicks by offer:', JSON.stringify(chByOfferRows));

 // --- Conversion enrichment check (geo inheritance from click) ---
 const enrichQ = await ch.query({
 query: `SELECT conversion_id, click_id, country, region, city, device, os
 FROM tracker.conversions FINAL
 WHERE network_id = {nid:UUID}
 ORDER BY conversion_id`,
 query_params: { nid: NET_A },
 format: 'JSONEachRow',
 });
 const enrichRows = await enrichQ.json<{
 conversion_id: string;
 click_id: string;
 country: string | null;
 region: string | null;
 city: string | null;
 device: string | null;
 os: string | null;
 }[]>();
 console.log('CH conversion enrichment:');
 for (const r of enrichRows) {
 console.log(
 ` ${r.conversion_id} click=${r.click_id} country=${r.country} region=${r.region} city=${r.city} device=${r.device} os=${r.os}`,
 );
 }

 // --- Conversion with missing click must still be present, with NULL geo ---
 const missingQ = await ch.query({
 query: `SELECT conversion_id, click_id, country, region, city
 FROM tracker.conversions FINAL
 WHERE click_id = {cid:String} AND network_id = {nid:UUID}`,
 query_params: { cid: 'v-clk-missing', nid: NET_A },
 format: 'JSONEachRow',
 });
 const missingRows = await missingQ.json<{
 conversion_id: string;
 country: string | null;
 region: string | null;
 city: string | null;
 }[]>();
 console.log('CH v-clk-missing row(s):', JSON.stringify(missingRows));

 // --- v-cv-01 should inherit geo from v-clk-01 (US/CA/LA) ---
 const enrichedCheck = enrichRows.find(r => r.conversion_id === 'v-cv-01');
 console.log(
 `v-cv-01 enrichment: country=${enrichedCheck?.country} (expect US), region=${enrichedCheck?.region} (expect CA), city=${enrichedCheck?.city} (expect LA)`,
 );

 // --- v-cv-05 should inherit from v-clk-09 (AU/NSW/Sydney) ---
 const enrichedCheck2 = enrichRows.find(r => r.conversion_id === 'v-cv-05');
 console.log(
 `v-cv-05 enrichment: country=${enrichedCheck2?.country} (expect AU), region=${enrichedCheck2?.region} (expect NSW), city=${enrichedCheck2?.city} (expect Sydney)`,
 );

 // --- Conversion IDs / click_ids parity ---
 const pgCvRows = await pool.query(
 'SELECT conversion_id, click_id FROM conversions WHERE network_id = $1 AND created_at >= $2 AND created_at < $3 ORDER BY conversion_id',
 [NET_A, FROM, TO],
 );
 const chCvListQ = await ch.query({
 query: `SELECT conversion_id, click_id FROM tracker.conversions FINAL
 WHERE network_id = {nid:UUID}
 ORDER BY conversion_id`,
 query_params: { nid: NET_A },
 format: 'JSONEachRow',
 });
 const chCvList = await chCvListQ.json<{ conversion_id: string; click_id: string }[]>();
 const pgSet = pgCvRows.rows.map((r: any) => `${r.conversion_id}|${r.click_id}`).sort();
 const chSet = chCvList.map(r => `${r.conversion_id}|${r.click_id}`).sort();
 const setEq = pgSet.length === chSet.length && pgSet.every((v: string, i: number) => v === chSet[i]);
 console.log(`Conversion ID|click_id parity: ${setEq ? 'PASS' : 'FAIL'} (PG=${pgSet.length}, CH=${chSet.length})`);

 await closeClickHouse();
}

main().catch(e => {
 console.error('FATAL', e);
 process.exit(1);
});

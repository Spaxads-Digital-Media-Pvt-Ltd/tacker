/**
 * The advertiser digests (Communication Hub › Automated System Emails): "Advertiser Postback Received" and
 * "New Conversion Recorded". One email per postback would bury an advertiser, so each is an HOURLY digest
 * to the advertiser's contact email covering the previous whole hour (UTC): the postbacks we received for
 * their offers — recorded, held, refused and why — and the conversions recorded, with revenue per currency.
 * Off until a network turns them on (system-emails.ts defaultOn: false). Each network-hour is sent once
 * (a Redis claim), so a worker restart or a second worker never repeats it; quiet advertisers get nothing.
 */
import { query } from '../db/pool.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import { addMoney } from '../money.js';
import { escapeHtml, networkName, sendTransactional, systemEmailEnabled } from './transactional.js';

const CLAIM_TTL_S = 3 * 24 * 3600;

/** The previous whole UTC hour before `now`. */
export function digestWindow(now: Date): { from: Date; to: Date; label: string } {
  const to = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const from = new Date(to.getTime() - 3_600_000);
  return { from, to, label: `${from.toISOString().slice(0, 16).replace('T', ' ')}–${to.toISOString().slice(11, 16)} UTC` };
}

interface Advertiser { id: string; name: string; email: string }
interface PostbackAgg { advertiser_id: string; total: number; recorded: number; held: number; refused: Record<string, number> }
interface ConversionAgg { advertiser_id: string; total: number; approved: number; pending: number; rejected: number; revenue: Record<string, string> }

async function advertisers(networkId: string, ids: string[]): Promise<Map<string, Advertiser>> {
  if (!ids.length) return new Map();
  const { rows } = await query<{ id: string; name: string; contact_email: string | null }>(
    `SELECT id, name, contact_email FROM advertisers WHERE network_id = $1 AND id = ANY($2::uuid[]) AND status = 'active' AND contact_email IS NOT NULL`,
    [networkId, ids]);
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, email: r.contact_email! }]));
}

async function postbacks(networkId: string, from: Date, to: Date): Promise<PostbackAgg[]> {
  const { rows } = await query<{ advertiser_id: string; outcome: string; reason: string | null; n: number }>(
    `SELECT advertiser_id, outcome, reason, COUNT(*)::int AS n FROM inbound_postback_logs
      WHERE network_id = $1 AND advertiser_id IS NOT NULL AND created_at >= $2 AND created_at < $3
      GROUP BY advertiser_id, outcome, reason`, [networkId, from, to]);
  const by = new Map<string, PostbackAgg>();
  for (const r of rows) {
    const a = by.get(r.advertiser_id) ?? { advertiser_id: r.advertiser_id, total: 0, recorded: 0, held: 0, refused: {} };
    a.total += r.n;
    if (r.outcome === 'approved') a.recorded += r.n;
    else if (r.outcome === 'pending') { a.recorded += r.n; a.held += r.n; }
    else { const k = r.reason ? `${r.outcome} (${r.reason})` : r.outcome; a.refused[k] = (a.refused[k] ?? 0) + r.n; }
    by.set(r.advertiser_id, a);
  }
  return [...by.values()];
}

async function conversions(networkId: string, from: Date, to: Date): Promise<ConversionAgg[]> {
  const { rows } = await query<{ advertiser_id: string; status: string; currency: string | null; n: number; revenue: string }>(
    `SELECT advertiser_id, status, currency, COUNT(*)::int AS n, COALESCE(SUM(revenue), 0)::numeric(14,4)::text AS revenue
       FROM conversions
      WHERE network_id = $1 AND advertiser_id IS NOT NULL AND created_at >= $2 AND created_at < $3
        AND source NOT IN ('click', 'impression')
      GROUP BY advertiser_id, status, currency`, [networkId, from, to]);
  const by = new Map<string, ConversionAgg>();
  for (const r of rows) {
    const a = by.get(r.advertiser_id) ?? { advertiser_id: r.advertiser_id, total: 0, approved: 0, pending: 0, rejected: 0, revenue: {} };
    a.total += r.n;
    if (r.status === 'approved') {
      a.approved += r.n;
      // Approved revenue per currency — the amounts billed to the advertiser (text, exact).
      const cur = r.currency ?? '';
      a.revenue[cur] = a.revenue[cur] ? addMoney(a.revenue[cur]!, r.revenue) : r.revenue;
    } else if (r.status === 'pending') a.pending += r.n;
    else a.rejected += r.n;
    by.set(r.advertiser_id, a);
  }
  return [...by.values()];
}

const li = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

/** Send one network's digests for the hour before `now`. */
export async function sendNetworkDigests(networkId: string, now: Date = new Date()): Promise<{ postback: number; conversion: number }> {
  const out = { postback: 0, conversion: 0 };
  const [pbOn, cvOn] = await Promise.all([
    systemEmailEnabled(networkId, 'advertiser_postback_received'), systemEmailEnabled(networkId, 'new_conversion_recorded'),
  ]);
  if (!pbOn && !cvOn) return out;
  const w = digestWindow(now);
  // Claim this network-hour: never sent twice (a second worker, a retry, a restart).
  const claimed = await getRedis().set(`advdigest:${networkId}:${w.from.toISOString()}`, '1', 'EX', CLAIM_TTL_S, 'NX');
  if (claimed !== 'OK') return out;
  const [pbs, cvs] = await Promise.all([pbOn ? postbacks(networkId, w.from, w.to) : [], cvOn ? conversions(networkId, w.from, w.to) : []]);
  const people = await advertisers(networkId, [...new Set([...pbs, ...cvs].map((a) => a.advertiser_id))]);
  const net = await networkName(networkId);

  for (const a of pbs) {
    const adv = people.get(a.advertiser_id);
    if (!adv) continue;
    const refused = Object.entries(a.refused).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} × ${escapeHtml(k.replace(/_/g, ' '))}`);
    const r = await sendTransactional(networkId, 'advertiser_postback_received', [adv.email], {
      subject: `${net}: ${a.total} postback${a.total === 1 ? '' : 's'} received — ${w.label}`,
      html: [
        `<p>Hello ${escapeHtml(adv.name)},</p>`,
        `<p>${a.total} postback${a.total === 1 ? '' : 's'} for your offers reached ${escapeHtml(net)} between ${escapeHtml(w.label)}:</p>`,
        li([`${a.recorded} recorded${a.held ? ` (${a.held} held as pending)` : ''}`, ...(refused.length ? [`not recorded: ${refused.join(', ')}`] : [])]),
        '<p>Postbacks that are not recorded never count — check the click id, the transaction id and the security code you send.</p>',
      ].join('\n'),
    });
    if (r.sent) out.postback++;
  }
  for (const a of cvs) {
    const adv = people.get(a.advertiser_id);
    if (!adv) continue;
    const revenue = Object.entries(a.revenue).map(([cur, v]) => `${escapeHtml(v)}${cur ? ` ${escapeHtml(cur)}` : ''}`);
    const r = await sendTransactional(networkId, 'new_conversion_recorded', [adv.email], {
      subject: `${net}: ${a.total} new conversion${a.total === 1 ? '' : 's'} — ${w.label}`,
      html: [
        `<p>Hello ${escapeHtml(adv.name)},</p>`,
        `<p>${a.total} conversion${a.total === 1 ? '' : 's'} were recorded for your offers between ${escapeHtml(w.label)}:</p>`,
        li([`${a.approved} approved${revenue.length ? ` — revenue ${revenue.join(', ')}` : ''}`, `${a.pending} pending review`, ...(a.rejected ? [`${a.rejected} rejected`] : [])]),
      ].join('\n'),
    });
    if (r.sent) out.conversion++;
  }
  return out;
}

/** Every active network with a digest on (the worker, every 15 minutes — each hour goes out once). */
export async function sendAdvertiserDigests(now: Date = new Date()): Promise<{ networks: number; postback: number; conversion: number }> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM networks WHERE status = 'active'
        AND ((settings->'communicationHub'->'systemEmails'->>'advertiser_postback_received')::boolean
          OR (settings->'communicationHub'->'systemEmails'->>'new_conversion_recorded')::boolean)`);
  const total = { networks: rows.length, postback: 0, conversion: 0 };
  for (const n of rows) {
    try {
      const r = await sendNetworkDigests(n.id, now);
      total.postback += r.postback;
      total.conversion += r.conversion;
    } catch (err) {
      logger.warn({ err, networkId: n.id }, 'advertiser digest failed');
    }
  }
  return total;
}

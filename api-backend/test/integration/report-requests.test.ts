/**
 * Requested Reports + what a saved report's file holds — live DB (INTEGRATION_DB=1), SMTP mocked at
 * nodemailer.
 *
 *  - POST /api/report-requests queues an export of a saved report over a preset or a date range; the
 *    worker builds it; the list shows it; a finished one downloads as CSV. Own requests only (admins /
 *    managers: the network's). Bad ranges / unknown reports are refused.
 *  - The file is the page's report: its filters, its METRIC FILTERS (rows below a threshold left out) and
 *    its HIDDEN COLUMNS (left out of the CSV) — in an export and in a scheduled email alike.
 *  - A scheduled report with more rows than an email carries attaches the first ones and leaves the whole
 *    file in Requested Reports.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { vi } from 'vitest';

const smtp = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: async (m: Record<string, unknown>) => { smtp.sent.push(m); return { messageId: 'x' }; } }) },
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { processReportRequest, sweepReportRequests } from '../../src/lib/reporting/report-requests.js';
import { sendSavedReport, type SavedReportRow } from '../../src/lib/reporting/saved-reports.js';
import { addDays } from '../../src/lib/reporting/time-zone.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('requested reports + metric filters / hidden columns in report files (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  const DAY = addDays(new Date().toISOString().slice(0, 10), -3);
  const as = (role: string, userId: string = randomUUID()) => ({ userId, headers: bearer(operatorToken({ userId, networkId: fx.networkA, role })) });
  const save = async (who: ReturnType<typeof as>, config: Record<string, unknown>, page = 'partner-report') =>
    (await request(dash).put('/api/saved-reports/by-name').set(who.headers).send({ page, name: `Report ${randomUUID().slice(0, 6)}`, config })).body.data as { id: string };
  const ask = (who: ReturnType<typeof as>, body: Record<string, unknown>) => request(dash).post('/api/report-requests').set(who.headers).send(body);
  const download = (who: ReturnType<typeof as>, id: string) => request(dash).get(`/api/report-requests/${id}/download`).set(who.headers);
  const csvRows = (csv: string) => csv.trim().split('\r\n');

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`rreq-${randomUUID().slice(0, 8)}`);
    await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [fx.networkA, JSON.stringify({
      smtp: { host: 'smtp.example.test', port: 587, username: 'u', password: 'p', fromEmail: 'r@example.test', fromName: 'R' },
    })]);
    dash = buildDashboardApp();
    // pubA1: 10 clicks, 3 approved conversions; pubA2: 6 clicks, none — on DAY (UTC network).
    const tag = randomUUID().slice(0, 8);
    for (const [pub, clicks, convs] of [[fx.pubA1, 10, 3], [fx.pubA2, 6, 0]] as const) {
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) SELECT $5 || g, $1, $2, $3, $4::timestamptz FROM generate_series(1, $6::int) g`,
        [fx.networkA, fx.offerA, pub, `${DAY}T12:00:00Z`, `${tag}-${pub.slice(0, 4)}-`, clicks]);
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, source, status, payout, revenue, currency, created_at)
         SELECT 'cv-' || $5 || g, $1, $5 || g, $2, $3, 'postback', 'approved', 5, 8, 'USD', $4::timestamptz FROM generate_series(1, $6::int) g`,
        [fx.networkA, fx.offerA, pub, `${DAY}T12:30:00Z`, `${tag}-${pub.slice(0, 4)}-`, convs]);
    }
  });
  beforeEach(() => { smtp.sent.length = 0; });

  it('an export is queued, built by the worker, listed and downloaded — with the metric filters and hidden columns applied', async () => {
    const admin = as('admin');
    const saved = await save(admin, { filters: { offer: [fx.offerA] }, metricFilters: { cv: { op: '>=', value: '1' } }, hiddenColumns: ['CVR', 'EPC'] });
    const res = await ask(admin, { savedReportId: saved.id, from: DAY, to: DAY });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'queued', format: 'csv', source: 'manual', range: { label: DAY } });
    const id = res.body.data.id as string;
    expect((await download(admin, id)).status).toBe(404); // no file yet

    expect(await processReportRequest(id)).toBe('done');
    expect(await processReportRequest(id)).toBe('skipped'); // claimed once

    const list = await request(dash).get('/api/report-requests').set(admin.headers);
    expect(list.body.data[0]).toMatchObject({ id, status: 'done', rows: 1, totalRows: 2, truncated: false });
    expect(list.body.pagination.total).toBeGreaterThanOrEqual(1);

    const file = await download(admin, id);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/csv/);
    expect(file.headers['content-disposition']).toMatch(/attachment; filename=".*\.csv"/);
    const lines = csvRows(file.text);
    expect(lines[0]).toBe('partner,partner_id,clicks,unique_clicks,conversions,payout,revenue,margin,invalid_clicks,total_conversions,currencies');
    expect(lines).toHaveLength(2); // only pubA1 (CV ≥ 1)
    expect(lines[1]).toContain(fx.pubA1);
    expect(lines[1]).toContain(',10,');
  });

  it('a preset works; bad ranges, an unknown or someone else’s saved report are refused', async () => {
    const admin = as('admin');
    const saved = await save(admin, {});
    expect((await ask(admin, { savedReportId: saved.id, rangePreset: 'last_7_days' })).body.data.range.label).toMatch(/ – /);
    expect((await ask(admin, { savedReportId: saved.id, from: DAY })).status).toBe(422);
    expect((await ask(admin, { savedReportId: saved.id, from: DAY, to: addDays(DAY, -1) })).status).toBe(422);
    expect((await ask(admin, { savedReportId: saved.id, from: '2024-01-01', to: '2025-06-01' })).status).toBe(422); // > 366 days
    expect((await ask(admin, { savedReportId: randomUUID(), rangePreset: 'yesterday' })).status).toBe(404);
    const viewer = as('read_only');
    expect((await ask(viewer, { savedReportId: saved.id, rangePreset: 'yesterday' })).status).toBe(404);
  });

  it("everyone sees their own requests; admins / managers can list and download the network's", async () => {
    const viewer = as('read_only');
    const mine = await save(viewer, {});
    const id = (await ask(viewer, { savedReportId: mine.id, from: DAY, to: DAY })).body.data.id as string;
    await processReportRequest(id);
    const other = as('finance');
    expect((await download(other, id)).status).toBe(404);
    expect((await request(dash).get(`/api/report-requests/${id}`).set(other.headers)).status).toBe(404);
    expect((await request(dash).get('/api/report-requests?scope=network').set(other.headers)).status).toBe(403);
    const manager = as('manager');
    const all = (await request(dash).get('/api/report-requests?scope=network&limit=200').set(manager.headers)).body.data as { id: string }[];
    expect(all.map((r) => r.id)).toContain(id);
    expect((await download(manager, id)).status).toBe(200);
    expect((await request(dash).delete(`/api/report-requests/${id}`).set(viewer.headers)).body.data).toEqual({ deleted: true });
    expect((await download(viewer, id)).status).toBe(404);
  });

  it('a scheduled email applies the metric filters and hidden columns; too many rows → the first attached, the whole file in Requested Reports', async () => {
    const admin = as('admin');
    const saved = await save(admin, { hiddenColumns: ['Payout', 'Revenue', 'Profit'] });
    const row = (await query<SavedReportRow>('SELECT * FROM saved_reports WHERE id = $1', [saved.id])).rows[0]!;
    // "yesterday" wouldn't include DAY: run as of DAY + 1.
    const now = new Date(`${addDays(DAY, 1)}T06:00:00Z`);
    const out = await sendSavedReport({ ...row, recipients: ['ops@example.com'] }, now, { attachRows: 1 });
    expect(out.rows).toBe(2);
    const mail = smtp.sent.at(-1)!;
    const att = (mail['attachments'] as { content: string }[])[0]!;
    const lines = csvRows(att.content);
    expect(lines[0]).toBe('partner,partner_id,clicks,unique_clicks,conversions,cr,epc,invalid_clicks,total_conversions');
    expect(lines).toHaveLength(2); // 1 of 2 attached
    expect(String(mail['html'])).toMatch(/the first 1 of 2 — the whole file is in Reporting › Saved &amp; Scheduled › Requested Reports, #\d+/);
    const stored = (await query<{ id: string; status: string; source: string; row_count: number }>(
      `SELECT id, status, source, row_count FROM report_requests WHERE saved_report_id = $1 AND source = 'scheduled'`, [saved.id])).rows;
    expect(stored).toEqual([expect.objectContaining({ status: 'done', source: 'scheduled', row_count: 2 })]);
    expect(csvRows((await download(admin, stored[0]!.id)).text)).toHaveLength(3);
  });

  it('the sweep re-queues a request whose job never ran and fails one interrupted mid-build', async () => {
    const admin = as('admin');
    const saved = await save(admin, {});
    const [a, b] = [
      (await ask(admin, { savedReportId: saved.id, rangePreset: 'yesterday' })).body.data.id as string,
      (await ask(admin, { savedReportId: saved.id, rangePreset: 'yesterday' })).body.data.id as string,
    ];
    await query(`UPDATE report_requests SET created_at = now() - interval '10 minutes' WHERE id = $1`, [a]);
    await query(`UPDATE report_requests SET status = 'processing', started_at = now() - interval '2 hours' WHERE id = $1`, [b]);
    const r = await sweepReportRequests();
    expect(r.requeued).toBeGreaterThanOrEqual(1);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect((await query<{ status: string; error: string }>('SELECT status, error FROM report_requests WHERE id = $1', [b])).rows[0])
      .toEqual({ status: 'failed', error: 'Interrupted — request it again.' });
  });
});

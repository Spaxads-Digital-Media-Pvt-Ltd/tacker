/**
 * Saved reports on the server + scheduled delivery — on a real Postgres (INTEGRATION_DB=1, as in CI)
 * with SMTP mocked at nodemailer, so the real mailer runs (settings, attachments) — audit F-24.
 *
 * A report page's saved configuration belongs to the user who saved it (synced by name). Every role
 * can schedule its own (D4) — a valid 5-field cron and a recipient; its next run is computed in the
 * network's time zone — and a report is emailed with its OWNER's permissions: an admin's / manager's
 * anywhere, a Finance / Read-only member's only to their own email, a disabled member's to nobody —
 * checked on save and again at every run. When it's due, the worker re-runs the saved config for the
 * rolling range and emails a summary + the rows as CSV, then waits for its next slot. SMTP that isn't
 * configured, or that refuses the mail, is recorded on the report — never thrown.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const smtp = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[], fail: false }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: Record<string, unknown>) => {
        if (smtp.fail) throw new Error('connect ECONNREFUSED 10.0.0.9:587');
        smtp.sent.push(m);
        return { messageId: randomUUID() };
      },
    }),
  },
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { runDueSavedReports } from '../../src/lib/reporting/saved-reports.js';
import { addDays, formatInZone, localDate, zonedDayStart } from '../../src/lib/reporting/time-zone.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';
import { getRedis } from '../../src/lib/redis.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const TZ = 'Asia/Kolkata';

d('saved reports + scheduled delivery (live DB, mock SMTP)', () => {
  let dash: Express;
  let fx: Fixture;
  const as = (role: string, userId: string = randomUUID(), networkId = fx.networkA) =>
    ({ userId, headers: bearer(operatorToken({ userId, networkId, role })) });
  let admin: ReturnType<typeof as>;
  /** A team member with a users row — their role, status and email on record. */
  const member = async (role: string, networkId = fx.networkA) => {
    const who = as(role, randomUUID(), networkId);
    const email = `${role.replace('_', '')}-${randomUUID().slice(0, 6)}@example.com`;
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
      [networkId, who.userId, email, `${role} person`, role]);
    return { ...who, email };
  };
  const save = (who: { headers: Record<string, string> }, body: Record<string, unknown>) =>
    request(dash).put('/api/saved-reports/by-name').set(who.headers).send(body);
  const patch = (who: { headers: Record<string, string> }, id: string, body: Record<string, unknown>) =>
    request(dash).patch(`/api/saved-reports/${id}`).set(who.headers).send(body);
  const rowOf = async (id: string) => (await query<{
    next_run_at: Date | null; last_run_at: Date | null; last_run_status: string | null; last_run_detail: string | null;
  }>('SELECT next_run_at, last_run_at, last_run_status, last_run_detail FROM saved_reports WHERE id = $1', [id])).rows[0]!;
  const makeDue = (id: string) => query(`UPDATE saved_reports SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  const mailTo = (addr: string) => smtp.sent.filter((m) => m['to'] === addr);
  const configureSmtp = (networkId: string) => query(
    `UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [networkId, JSON.stringify({ smtp: { host: 'smtp.example.test', port: 587, username: 'mailer', password: 'legacy-plain', fromEmail: 'reports@example.test', fromName: 'Net A Reports' } })]);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`sched-${randomUUID().slice(0, 8)}`);
    for (const n of [fx.networkA, fx.networkB]) {
      await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [n, JSON.stringify({ general: { timezone: TZ } })]);
    }
    await configureSmtp(fx.networkA); // network B has no SMTP
    dash = buildDashboardApp();
    admin = as('admin');
  });
  beforeEach(() => { smtp.sent.length = 0; smtp.fail = false; });
  // Leave nothing scheduled behind for later runs' workers.
  afterAll(async () => {
    if (fx) await query('UPDATE saved_reports SET schedule = NULL, next_run_at = NULL WHERE network_id = ANY($1)', [[fx.networkA, fx.networkB]]);
  });

  describe('the API', () => {
    it("saving by name creates the caller's own report; saving again replaces its config; lists are the caller's unless scope=network", async () => {
      const name = `Top partners ${randomUUID().slice(0, 6)}`;
      const first = await save(admin, { page: 'partner-report', name, config: { orderBy: 'clicks' } });
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ page: 'partner-report', name, config: { orderBy: 'clicks' }, ownerUserId: admin.userId, schedule: null, rangePreset: 'yesterday', recipients: [] });
      const again = await save(admin, { page: 'partner-report', name, config: { orderBy: 'revenue' } });
      expect(again.body.data).toMatchObject({ id: first.body.data.id, config: { orderBy: 'revenue' } });

      const viewer = as('read_only');
      const theirs = await save(viewer, { page: 'partner-report', name, config: { orderBy: 'cr' } }); // same name, their own
      expect(theirs.status).toBe(200);
      expect(theirs.body.data.id).not.toBe(first.body.data.id);

      const mine = (await request(dash).get('/api/saved-reports?page=partner-report').set(admin.headers)).body.data as { id: string }[];
      expect(mine.map((r) => r.id)).toEqual([first.body.data.id]);
      const all = (await request(dash).get('/api/saved-reports?scope=network').set(admin.headers)).body.data as { id: string }[];
      expect(all.map((r) => r.id)).toEqual(expect.arrayContaining([first.body.data.id, theirs.body.data.id]));

      // Deleting by name deletes only the caller's.
      const del = await request(dash).delete(`/api/saved-reports/by-name?page=partner-report&name=${encodeURIComponent(name)}`).set(viewer.headers);
      expect(del.body.data).toEqual({ deleted: true });
      expect((await request(dash).get('/api/saved-reports?scope=network').set(admin.headers)).body.data.map((r: { id: string }) => r.id))
        .toEqual(expect.arrayContaining([first.body.data.id]));
      expect((await query('SELECT 1 FROM saved_reports WHERE id = $1', [theirs.body.data.id])).rowCount).toBe(0);
    });

    it('bad input is refused (unknown page, empty name, an oversized config)', async () => {
      expect((await save(admin, { page: 'nope-report', name: 'x', config: {} })).status).toBe(422);
      expect((await save(admin, { page: 'offer-report', name: '  ', config: {} })).status).toBe(422);
      expect((await save(admin, { page: 'offer-report', name: 'big', config: { blob: 'x'.repeat(20_001) } })).status).toBe(422);
      expect((await request(dash).get('/api/saved-reports?page=nope').set(admin.headers)).status).toBe(422);
    });

    it("every role schedules its own reports; Finance and Read-only only to their own email, whoever edits them", async () => {
      const viewer = await member('read_only');
      const id = (await save(viewer, { page: 'offer-report', name: `Mine ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      const listed = (await request(dash).get('/api/saved-reports?page=offer-report').set(viewer.headers)).body.data as Record<string, unknown>[];
      expect(listed.find((r) => r['id'] === id)).toMatchObject({ scheduleTo: 'self', owner: { name: 'read_only person', email: viewer.email, disabled: false } });

      // Someone else's address → refused, with the reason (and their own address) for the form.
      const denied = await patch(viewer, id, { schedule: '0 8 * * *', recipients: ['ops@example.com', viewer.email] });
      expect(denied.status).toBe(403);
      expect(denied.body.error.details).toEqual({ reason: 'recipients_self_only', email: viewer.email });
      expect(denied.body.error.message).toMatch(/only to their own email/);
      // Their own address (any case) → scheduled; the next run in the network's zone.
      const before = Date.now();
      const ok = await patch(viewer, id, { schedule: '0 8 * * *', recipients: [viewer.email.toUpperCase()], rangePreset: 'last_7_days' });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ schedule: '0 8 * * *', rangePreset: 'last_7_days', recipients: [viewer.email], scheduleTo: 'self' });
      const next = new Date(ok.body.data.nextRunAt);
      expect(formatInZone(next, TZ).slice(11, 19)).toBe('08:00:00'); // 08:00 Kolkata = 02:30 UTC
      expect(next.getTime()).toBeGreaterThan(before);
      expect(next.getTime()).toBeLessThanOrEqual(before + 24 * 3600_000);
      // No recipients given → their own.
      const fin = await member('finance');
      const finId = (await save(fin, { page: 'daily-report', name: `F ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      const finOk = await patch(fin, finId, { schedule: '30 9 * * 1' });
      expect(finOk.status).toBe(200);
      expect(finOk.body.data.recipients).toEqual([fin.email]);

      // Someone else's report: only an admin / manager may change it…
      expect((await patch(fin, id, { name: 'Taken' })).status).toBe(403);
      // …and even then it goes only to its owner; they can unschedule it.
      const manager = await member('manager');
      const widen = await patch(manager, id, { recipients: ['ops@example.com'] });
      expect(widen.status).toBe(403);
      expect(widen.body.error.message).toMatch(/Save your own copy/);
      const off = await patch(manager, id, { schedule: null });
      expect(off.body.data).toMatchObject({ schedule: null, nextRunAt: null });
    });

    it('admin / manager reports go to any address; a schedule needs a valid cron and a recipient, and is audited', async () => {
      const manager = await member('manager');
      const id = (await save(manager, { page: 'offer-report', name: `Ops ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      const noRecipients = await patch(manager, id, { schedule: '0 8 * * *' });
      expect(noRecipients.status).toBe(422);
      expect(noRecipients.body.error.message).toMatch(/at least one recipient/);
      const badCron = await patch(manager, id, { schedule: '0 25 * * *', recipients: ['ops@example.com'] });
      expect(badCron.status).toBe(422);
      expect(badCron.body.error.message).toBe('schedule: hour: "25" is out of range 0-23');
      expect((await patch(manager, id, { schedule: '0 0 31 2 *', recipients: ['ops@example.com'] })).body.error.message).toBe('schedule: never runs');
      expect((await patch(manager, id, { recipients: ['not-an-email'] })).status).toBe(422);

      const ok = await patch(manager, id, { schedule: '0 8 * * *', recipients: ['Ops@Example.com', 'ops@example.com', 'cfo@example.com'], rangePreset: 'last_7_days' });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ scheduleTo: 'anyone', schedule: '0 8 * * *', recipients: ['ops@example.com', 'cfo@example.com'] });

      const audit = await query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
        `SELECT before, after FROM audit_log WHERE network_id = $1 AND entity_id = $2 AND action = 'saved_report.schedule' ORDER BY created_at`, [fx.networkA, id]);
      expect(audit.rows.at(-1)).toMatchObject({ before: { schedule: null, recipients: [] }, after: { schedule: '0 8 * * *', recipients: ['ops@example.com', 'cfo@example.com'] } });

      // A disabled owner's report can't be scheduled (it can still be unscheduled).
      const gone = await member('manager');
      const goneId = (await save(gone, { page: 'offer-report', name: `Gone ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      await query(`UPDATE users SET status = 'disabled' WHERE auth_user_id = $1`, [gone.userId]);
      expect((await patch(manager, goneId, { schedule: '0 8 * * *', recipients: ['ops@example.com'] })).status).toBe(409);
      expect((await patch(manager, goneId, { schedule: null })).status).toBe(200);
    });

    it("only admins and managers list everyone's saved reports", async () => {
      const viewer = await member('read_only');
      const id = (await save(viewer, { page: 'hourly-report', name: `H ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      expect((await request(dash).get('/api/saved-reports?scope=network').set(viewer.headers)).status).toBe(403);
      expect((await request(dash).get('/api/saved-reports?scope=network').set((await member('finance')).headers)).status).toBe(403);
      const all = (await request(dash).get('/api/saved-reports?scope=network').set((await member('manager')).headers)).body.data as Record<string, unknown>[];
      expect(all.find((r) => r['id'] === id)).toMatchObject({ owner: { name: 'read_only person', email: viewer.email }, scheduleTo: 'self' });
    });

    it('delete by id: its owner or an admin / manager', async () => {
      const owner = as('read_only');
      const id = (await save(owner, { page: 'daily-report', name: `D ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      expect((await request(dash).delete(`/api/saved-reports/${id}`).set(as('finance').headers)).status).toBe(403);
      expect((await request(dash).delete(`/api/saved-reports/${id}`).set(owner.headers)).body.data).toEqual({ deleted: true });
      expect((await request(dash).delete(`/api/saved-reports/${id}`).set(admin.headers)).status).toBe(404);
    });

    it("another network can't see, change, send or delete it", async () => {
      const id = (await save(admin, { page: 'offer-report', name: `Private ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      const other = as('admin', randomUUID(), fx.networkB);
      const listed = (await request(dash).get('/api/saved-reports?scope=network').set(other.headers)).body.data as { id: string }[];
      expect(listed.map((r) => r.id)).not.toContain(id);
      expect((await patch(other, id, { name: 'x' })).status).toBe(404);
      expect((await request(dash).post(`/api/saved-reports/${id}/send`).set(other.headers)).status).toBe(404);
      expect((await request(dash).delete(`/api/saved-reports/${id}`).set(other.headers)).status).toBe(404);
    });
  });

  describe('delivery', () => {
    /** Network A traffic: yesterday (local) 3 clicks + 1 approved conversion for pubA1, 2 clicks for pubA2; today 1 click for pubA1. */
    let yesterday: string;
    beforeAll(async () => {
      const today = localDate(new Date(), TZ);
      yesterday = addDays(today, -1);
      const y = new Date(zonedDayStart(yesterday, TZ).getTime() + 2 * 3600_000).toISOString();
      const t = new Date(zonedDayStart(today, TZ).getTime() + 60_000).toISOString();
      const p = `f24-${randomUUID().slice(0, 8)}-`;
      const click = (id: string, pub: string, at: string) => query(
        'INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) VALUES ($1, $2, $3, $4, $5)', [p + id, fx.networkA, fx.offerA, pub, at]);
      for (const i of [1, 2, 3]) await click(`a${i}`, fx.pubA1, y);
      for (const i of [1, 2]) await click(`b${i}`, fx.pubA2, y);
      await click('today', fx.pubA1, t);
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, created_at, status, payout, revenue, currency, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', 2.5, 4, 'USD', 'postback')`,
        [p + 'conv', fx.networkA, p + 'a1', fx.offerA, fx.pubA1, fx.advA, y]);
    });

    const scheduled = async (networkId: string, recipients: string[], config: Record<string, unknown> = {}) => {
      const who = as('admin', randomUUID(), networkId);
      const name = `Top partners ${randomUUID().slice(0, 6)}`;
      const id = (await save(who, { page: 'partner-report', name, config })).body.data.id as string;
      const res = await patch(who, id, { schedule: '0 8 * * *', recipients, rangePreset: 'yesterday' });
      expect(res.status).toBe(200);
      return { id, name, who };
    };

    it('a due report runs its saved config for the rolling range and emails the CSV, then waits for its next slot', async () => {
      const to = [`ops-${randomUUID().slice(0, 6)}@example.com`, `cfo-${randomUUID().slice(0, 6)}@example.com`];
      const { id, name } = await scheduled(fx.networkA, to, {
        filters: { offer: [fx.offerA] }, exclusions: { partner: [fx.pubA2] }, orderBy: 'clicks', orderDir: 'desc',
      });
      expect(await runDueSavedReports(new Date())).toBeDefined();
      expect(mailTo(to[0]!)).toHaveLength(0); // not due yet

      await makeDue(id);
      const now = new Date();
      await runDueSavedReports(now);

      for (const addr of to) expect(mailTo(addr)).toHaveLength(1); // one email per recipient
      const mail = mailTo(to[0]!)[0]!;
      const netName = (await query<{ name: string }>('SELECT name FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.name;
      expect(mail['from']).toBe('"Net A Reports" <reports@example.test>');
      expect(mail['subject']).toBe(`${netName}: ${name} — ${yesterday}`);
      expect(mail['html']).toContain(`(${TZ})`);
      expect(mail['html']).toContain('Clicks 3 · Conversions 1');
      expect(mail['html']).toContain('payout 2.5000, revenue 4.0000, margin 1.5000 USD');
      expect(mail['html']).toContain('1 row attached as CSV');

      const [att] = mail['attachments'] as { filename: string; content: string; contentType: string }[];
      expect(att!.filename).toBe(`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${yesterday}.csv`);
      expect(att!.contentType).toBe('text/csv');
      const lines = att!.content.trimEnd().split('\r\n');
      expect(lines[0]).toBe('partner,partner_id,clicks,unique_clicks,conversions,cr,payout,revenue,margin,epc,invalid_clicks,total_conversions,currencies');
      expect(lines).toHaveLength(2); // pubA2 excluded, today's click outside the range
      const cells = lines[1]!.split(',');
      expect([cells[0], cells[1], cells[2], cells[4], cells[6], cells[7], cells[8], cells[12]])
        .toEqual(['Pub A1', fx.pubA1, '3', '1', '2.5000', '4.0000', '1.5000', 'USD']);

      const row = await rowOf(id);
      expect(row).toMatchObject({ last_run_status: 'sent', last_run_detail: '1 rows to 2 recipient(s)' });
      expect(row.last_run_at!.getTime()).toBe(now.getTime());
      expect(row.next_run_at!.getTime()).toBeGreaterThan(now.getTime()); // the next 08:00 Kolkata
      expect(formatInZone(row.next_run_at!, TZ).slice(11, 16)).toBe('08:00');

      // Not due again until then.
      await runDueSavedReports(new Date());
      expect(mailTo(to[0]!)).toHaveLength(1);
    });

    it('SMTP not configured → recorded as skipped with the reason; it still waits for its next slot', async () => {
      const to = `b-${randomUUID().slice(0, 6)}@example.com`;
      const { id } = await scheduled(fx.networkB, [to]);
      await makeDue(id);
      const now = new Date();
      await runDueSavedReports(now);
      expect(mailTo(to)).toHaveLength(0);
      const row = await rowOf(id);
      expect(row.last_run_status).toBe('skipped');
      expect(row.last_run_detail).toMatch(/SMTP is not fully configured/);
      expect(row.next_run_at!.getTime()).toBeGreaterThan(now.getTime());
    });

    it('SMTP refusing the mail is recorded on the report (no retry storm: it waits for its next slot)', async () => {
      const to = `x-${randomUUID().slice(0, 6)}@example.com`;
      const { id } = await scheduled(fx.networkA, [to]);
      await makeDue(id);
      smtp.fail = true;
      const now = new Date();
      await runDueSavedReports(now);
      const row = await rowOf(id);
      expect(row).toMatchObject({ last_run_status: 'skipped', last_run_detail: 'connect ECONNREFUSED 10.0.0.9:587' });
      expect(row.next_run_at!.getTime()).toBeGreaterThan(now.getTime());
    });

    it("a run goes with its owner's permissions as they are NOW: demoted → their own email only; email changed → the new one; disabled → not sent", async () => {
      const m = await member('manager');
      const id = (await save(m, { page: 'partner-report', name: `Team ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      const team = `team-${randomUUID().slice(0, 6)}@example.com`;
      expect((await patch(m, id, { schedule: '0 8 * * *', recipients: [team], rangePreset: 'yesterday' })).status).toBe(200);

      // Demoted to Finance after scheduling: the run reaches only them.
      await query(`UPDATE users SET role = 'finance' WHERE auth_user_id = $1`, [m.userId]);
      await makeDue(id);
      await runDueSavedReports(new Date());
      expect(mailTo(team)).toHaveLength(0);
      expect(mailTo(m.email)).toHaveLength(1);
      expect(await rowOf(id)).toMatchObject({ last_run_status: 'sent' });
      expect((await rowOf(id)).last_run_detail).toMatch(/to 1 recipient\(s\) — its owner's own email only/);

      // Their email changes: the next run follows it.
      const moved = `moved-${randomUUID().slice(0, 6)}@example.com`;
      await query('UPDATE users SET email = $2 WHERE auth_user_id = $1', [m.userId, moved]);
      await makeDue(id);
      await runDueSavedReports(new Date());
      expect(mailTo(moved)).toHaveLength(1);

      // Disabled: nothing goes out, the report says why, and it keeps its slot for when they're back.
      await query(`UPDATE users SET status = 'disabled' WHERE auth_user_id = $1`, [m.userId]);
      await makeDue(id);
      const now = new Date();
      await runDueSavedReports(now);
      expect(mailTo(moved)).toHaveLength(1);
      expect(await rowOf(id)).toMatchObject({ last_run_status: 'skipped', last_run_detail: "Not sent: its owner's account is disabled." });
      expect((await rowOf(id)).next_run_at!.getTime()).toBeGreaterThan(now.getTime());
      expect((await request(dash).post(`/api/saved-reports/${id}/send`).set(admin.headers)).status).toBe(409);
    });

    it('send now: its owner or an admin / manager, audited, same email as a scheduled run, 20 an hour per person', async () => {
      const to = `now-${randomUUID().slice(0, 6)}@example.com`;
      const { id, name } = await scheduled(fx.networkA, [to], { filters: { partner: [fx.pubA1] } });
      expect((await request(dash).post(`/api/saved-reports/${id}/send`).set(as('read_only').headers)).status).toBe(403); // not theirs
      const res = await request(dash).post(`/api/saved-reports/${id}/send`).set(admin.headers);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ sent: true, recipients: [to], rows: 1 });
      expect(mailTo(to)).toHaveLength(1);
      expect(mailTo(to)[0]!['subject']).toContain(name);
      const audit = await query(`SELECT 1 FROM audit_log WHERE network_id = $1 AND entity_id = $2 AND action = 'saved_report.send'`, [fx.networkA, id]);
      expect(audit.rowCount).toBe(1);

      // No recipients → refused before anything runs.
      const bare = (await save(admin, { page: 'offer-report', name: `Bare ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      expect((await request(dash).post(`/api/saved-reports/${bare}/send`).set(admin.headers)).status).toBe(422);

      // A Read-only member sends their own — to themselves, scheduled or not.
      const viewer = await member('read_only');
      const own = (await save(viewer, { page: 'offer-report', name: `Own ${randomUUID().slice(0, 6)}`, config: {} })).body.data.id as string;
      const mine = await request(dash).post(`/api/saved-reports/${own}/send`).set(viewer.headers);
      expect(mine.status).toBe(200);
      expect(mine.body.data).toMatchObject({ sent: true, recipients: [viewer.email] });
      expect(mailTo(viewer.email)).toHaveLength(1);
      // The hourly limit (20 sends per person).
      await getRedis().set(`srsend:${fx.networkA}:${viewer.userId}`, '20', 'EX', 3600);
      const limited = await request(dash).post(`/api/saved-reports/${own}/send`).set(viewer.headers);
      expect(limited.status).toBe(429);
      expect(mailTo(viewer.email)).toHaveLength(1);
    });
  });
});

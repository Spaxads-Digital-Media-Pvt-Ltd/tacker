/**
 * Email through a queue (O11) — on a real Postgres (INTEGRATION_DB=1) and the REAL email worker (BullMQ
 * on the test Redis), with the mail server faked.
 *
 * - Emails are recorded in email_outbox (one row per recipient) and sent by the worker; a credential
 *   email (invite / reset) is stored encrypted until sent, then wiped. A failing server is retried and
 *   then marked failed; SMTP that isn't set up is refused up front (nothing queued).
 * - Communication Hub: the Email Log lists rows (never bodies) and retries failed non-credential ones;
 *   Automated System Emails only lists toggles that really send; campaign "Send now" queues per person.
 * - The partner notifications go out on their events, to the right partners, honouring their toggles.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { Worker } from 'bullmq';

const mail = vi.hoisted(() => ({
  configError: null as string | null,
  failSends: 0, // the next N sends fail
  sent: [] as { networkId: string; to: string[]; subject: string; html: string }[],
}));
vi.mock('../../src/lib/mailer.js', () => ({
  smtpConfigError: async () => mail.configError,
  sendNetworkEmail: async (networkId: string, to: string[], subject: string, html: string) => {
    if (mail.configError) return { sent: 0, results: [], configError: mail.configError };
    if (mail.failSends > 0) {
      mail.failSends--;
      return { sent: 0, results: to.map((recipient) => ({ recipient, ok: false, error: 'connect ECONNREFUSED' })) };
    }
    mail.sent.push({ networkId, to, subject, html });
    return { sent: to.length, results: to.map((recipient) => ({ recipient, ok: true })) };
  },
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { sendTransactional } from '../../src/lib/email/transactional.js';
import { enqueueEmails, deliverOutboxEmail } from '../../src/lib/email/outbox.js';
import { startEmailWorker } from '../../src/surfaces/workers/processors/email.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('email through a queue (live DB, real email worker, fake mail server)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;
  let worker: Worker;

  const until = async (fn: () => Promise<boolean> | boolean, ms = 8000) => {
    for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
    return false;
  };
  const outbox = async (recipient: string) => (await query<{ id: string; status: string; html: string; sensitive: boolean; attempts: number; last_error: string | null; event: string }>(
    'SELECT id, status, html, sensitive, attempts, last_error, event FROM email_outbox WHERE network_id = $1 AND recipient = $2 ORDER BY created_at', [fx.networkA, recipient])).rows;
  const mailsTo = (to: string) => mail.sent.filter((m) => m.to.includes(to));
  const email = () => `q-${randomUUID().slice(0, 8)}@example.com`;
  const partner = async (status = 'active', contact: string | null = email()) => {
    const id = (await query<{ id: string }>(
      `INSERT INTO publishers (network_id, name, status, contact_email) VALUES ($1, $2, $3, $4) RETURNING id`,
      [fx.networkA, `Partner ${randomUUID().slice(0, 5)}`, status, contact])).rows[0]!.id;
    return { id, email: contact! };
  };
  const toggle = (key: string, enabled: boolean) => request(dash).put(`/api/communication-hub/system-emails/${key}`).set(admin).send({ enabled });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`mailq-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    worker = startEmailWorker();
  });
  afterAll(async () => { await worker?.close(); });
  beforeEach(() => { mail.sent.length = 0; mail.configError = null; mail.failSends = 0; });

  it('an email is queued, sent by the worker and logged; a credential email is encrypted until sent, then wiped', async () => {
    const to = email();
    const r = await sendTransactional(fx.networkA, 'staff_invite', [to], { subject: 'Your invite', html: '<p>Temporary password: <code>Secret-Pass-123</code></p>' }, { sensitive: true });
    expect(r).toMatchObject({ sent: true, queued: true, recipients: [to] });
    const [row] = await outbox(to);
    expect(row!.sensitive).toBe(true);
    expect(row!.html.startsWith('enc:v1:')).toBe(true);
    expect(row!.html).not.toContain('Secret-Pass-123');
    expect(await until(async () => (await outbox(to))[0]?.status === 'sent')).toBe(true);
    expect(mailsTo(to)[0]!.html).toContain('Secret-Pass-123'); // the person gets the real body
    const [after] = await outbox(to);
    expect(after).toMatchObject({ status: 'sent', html: '', attempts: 1, last_error: null });
  });

  it('a failing mail server is retried, then marked failed; SMTP not set up is refused up front', async () => {
    const to = email();
    // The queue's job is exercised above; here one attempt at a time (the real backoff is minutes).
    const { ids } = await enqueueEmails(fx.networkA, 'offer_details_shared', [to], { subject: 'Offers', html: '<p>hi</p>' });
    await until(async () => (await outbox(to))[0]?.attempts !== 0); // the worker picked it up already
    await query(`UPDATE email_outbox SET status = 'queued', attempts = 0, last_error = NULL WHERE id = $1 AND status <> 'queued'`, [ids[0]]);
    mail.failSends = 2;
    await expect(deliverOutboxEmail(ids[0]!, 1, false)).rejects.toThrow('ECONNREFUSED');
    expect((await outbox(to))[0]).toMatchObject({ status: 'queued', attempts: 1, last_error: 'connect ECONNREFUSED' });
    await expect(deliverOutboxEmail(ids[0]!, 2, true)).rejects.toThrow('ECONNREFUSED');
    expect((await outbox(to))[0]).toMatchObject({ status: 'failed', attempts: 2 });

    // Retry from the Email Log → sent by the worker.
    const retry = await request(dash).post(`/api/communication-hub/email-log/${ids[0]}/retry`).set(admin);
    expect(retry.status).toBe(200);
    expect(await until(async () => (await outbox(to))[0]?.status === 'sent')).toBe(true);

    // SMTP not set up: nothing queued, the caller hears why.
    mail.configError = 'SMTP is not fully configured yet';
    const none = email();
    const r = await sendTransactional(fx.networkA, 'offer_details_shared', [none], { subject: 'x', html: 'x' });
    expect(r).toMatchObject({ sent: false, skipped: 'smtp_not_configured' });
    expect(await outbox(none)).toHaveLength(0);
  });

  it('a mail setup problem at send time is final (no retries)', async () => {
    const to = email();
    mail.configError = "The stored SMTP password can't be decrypted";
    const { ids } = await enqueueEmails(fx.networkA, 'offer_details_shared', [to], { subject: 'x', html: 'x' });
    expect(await until(async () => (await outbox(to))[0]?.status === 'failed')).toBe(true);
    expect((await outbox(to))[0]).toMatchObject({ attempts: 1, last_error: "The stored SMTP password can't be decrypted" });
    expect(ids).toHaveLength(1);
  });

  it('the Email Log lists rows without bodies; credential emails are not retryable; only working toggles are listed', async () => {
    const to = email();
    mail.configError = 'boom';
    await enqueueEmails(fx.networkA, 'password_reset', [to], { subject: 'Reset', html: 'link' }, { sensitive: true });
    await until(async () => (await outbox(to))[0]?.status === 'failed');
    mail.configError = null;
    const log = await request(dash).get('/api/communication-hub/email-log?status=failed').set(admin);
    expect(log.status).toBe(200);
    const row = log.body.data.rows.find((r: { recipient: string }) => r.recipient === to);
    expect(row).toMatchObject({ event: 'password_reset', label: 'Password reset', status: 'failed', retryable: false });
    expect(JSON.stringify(log.body)).not.toMatch(/"html"/);
    expect((await request(dash).post(`/api/communication-hub/email-log/${row.id}/retry`).set(admin)).status).toBe(409);

    const ro = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'read_only' }));
    expect((await request(dash).get('/api/communication-hub/email-log').set(ro)).status).toBe(403);

    const list = await request(dash).get('/api/communication-hub/system-emails').set(admin);
    const keys = list.body.data.map((e: { key: string }) => e.key);
    expect(keys).toContain('partner_signup_approved');
    expect(keys).toContain('payout_batch_completed');
    expect(keys).toContain('advertiser_postback_received'); // hourly digests (off by default)
    expect(keys).toContain('new_conversion_recorded');
    expect((await toggle('not_an_email', false)).status).toBe(404);
  });

  it('Communication Hub "Send now" queues one email per recipient', async () => {
    const a = await partner('active');
    const b = await partner('active');
    const aud = await request(dash).post('/api/communication-hub/audiences').set(admin).send({ name: `Aud ${randomUUID().slice(0, 4)}`, groupType: 'publishers', statusFilter: ['active'] });
    expect(aud.status).toBe(201);
    const sent = await request(dash).post('/api/communication-hub/emails').set(admin)
      .send({ subject: 'Hello partners', body: '<p>News</p>', audienceId: aud.body.data.id, action: 'send' });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ status: 'sent' });
    expect(await until(() => mailsTo(a.email).length === 1 && mailsTo(b.email).length === 1)).toBe(true);
    expect((await outbox(a.email))[0]).toMatchObject({ event: 'communication_message', status: 'sent' });
  });

  it('partner sign-up approved / rejected emails go to the partner (and honour the toggle)', async () => {
    const yes = await partner('pending');
    const no = await partner('pending');
    expect((await request(dash).patch(`/api/publishers/${yes.id}`).set(admin).send({ status: 'active' })).status).toBe(200);
    expect((await request(dash).patch(`/api/publishers/${no.id}`).set(admin).send({ status: 'inactive' })).status).toBe(200);
    expect(await until(() => mailsTo(yes.email).length === 1 && mailsTo(no.email).length === 1)).toBe(true);
    expect(mailsTo(yes.email)[0]!.subject).toMatch(/approved/);
    expect(mailsTo(no.email)[0]!.html).toMatch(/not able to approve/);

    // An active partner edited again: no sign-up email. Toggle off: no email either.
    await request(dash).patch(`/api/publishers/${yes.id}`).set(admin).send({ status: 'inactive' });
    await toggle('partner_signup_approved', false);
    try {
      const later = await partner('pending');
      await request(dash).patch(`/api/publishers/${later.id}`).set(admin).send({ status: 'active' });
      await new Promise((r) => setTimeout(r, 400));
      expect(mailsTo(later.email)).toHaveLength(0);
      expect(mailsTo(yes.email)).toHaveLength(1);
    } finally {
      await toggle('partner_signup_approved', true);
    }
  });

  it('offer application decisions, access changes and availability reach the right partners', async () => {
    const applicant = await partner('active');
    const app = (await query<{ id: string }>(
      `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, 'allow', 'pending') RETURNING id`,
      [fx.networkA, fx.offerA, applicant.id])).rows[0]!.id;
    expect((await request(dash).patch(`/api/offer-applications/${app}`).set(admin).send({ status: 'approved' })).status).toBe(200);
    expect(await until(() => mailsTo(applicant.email).length === 1)).toBe(true);
    expect(mailsTo(applicant.email)[0]!.subject).toMatch(/approved to run/);

    // Running the offer = given access, or clicks in the last 30 days (rollups); blocked = never.
    const clicker = await partner('active');
    const blocked = await partner('active');
    const stranger = await partner('active');
    await query(
      `INSERT INTO stats_clicks_15m (network_id, bucket, offer_id, publisher_id, clicks, unique_clicks, invalid_clicks, fraud_score_sum)
       VALUES ($1, date_trunc('hour', now()) - interval '2 days', $2, $3, 4, 4, 0, 0)`, [fx.networkA, fx.offerA, clicker.id]);
    const blockRes = await request(dash).post(`/api/offers/${fx.offerA}/publishers`).set(admin).send({ publisherId: blocked.id, access: 'deny', approvalStatus: 'rejected' });
    expect(blockRes.status).toBe(201);
    mail.sent.length = 0;

    expect((await request(dash).patch(`/api/offers/${fx.offerA}`).set(admin).send({ status: 'paused' })).status).toBe(200);
    expect(await until(() => mailsTo(applicant.email).length === 1 && mailsTo(clicker.email).length === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(mailsTo(clicker.email)[0]!.subject).toMatch(/no longer available/);
    expect(mailsTo(blocked.email)).toHaveLength(0);
    expect(mailsTo(stranger.email)).toHaveLength(0);

    mail.sent.length = 0;
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(admin).send({ status: 'active' });
    expect(await until(() => mailsTo(clicker.email).length === 1)).toBe(true);
    expect(mailsTo(clicker.email)[0]!.subject).toMatch(/is available to you/);

    // A private offer: a partner given access directly hears it's available — only they do.
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(admin).send({ visibility: 'private' });
    await new Promise((r) => setTimeout(r, 300));
    mail.sent.length = 0;
    const granted = await partner('active');
    await request(dash).post(`/api/offers/${fx.offerA}/publishers`).set(admin).send({ publisherId: granted.id, access: 'allow', approvalStatus: 'approved' });
    expect(await until(() => mailsTo(granted.email).length === 1)).toBe(true);
    expect(mailsTo(granted.email)[0]!.subject).toMatch(/is available to you/);
    await new Promise((r) => setTimeout(r, 200));
    expect(mail.sent).toHaveLength(1);
    // Blocking someone who was running it tells them; their access entry was "allow".
    await request(dash).patch(`/api/offers/${fx.offerA}/publishers/${(await query<{ id: string }>(
      'SELECT id FROM offer_publisher_access WHERE offer_id = $1 AND publisher_id = $2', [fx.offerA, granted.id])).rows[0]!.id}`).set(admin).send({ access: 'deny' });
    expect(await until(() => mailsTo(granted.email).length === 2)).toBe(true);
    expect(mailsTo(granted.email)[1]!.subject).toMatch(/no longer available/);
    await request(dash).patch(`/api/offers/${fx.offerA}`).set(admin).send({ visibility: 'public' });
  });

  it('a new creative reaches the partners running the offer; a payout run tells each partner their own amount', async () => {
    const runner = await partner('active');
    await request(dash).post(`/api/offers/${fx.offerA}/publishers`).set(admin).send({ publisherId: runner.id, access: 'allow', approvalStatus: 'approved' });
    mail.sent.length = 0;
    const creative = await request(dash).post(`/api/offers/${fx.offerA}/creatives`).set(admin)
      .send({ name: 'Summer banner', type: 'link', url: 'https://example.com/banner' });
    expect(creative.status).toBe(201);
    const creativeMails = () => mailsTo(runner.email).filter((m) => /new creative/.test(m.subject));
    expect(await until(() => creativeMails().length === 1)).toBe(true);
    expect(creativeMails()[0]!.html).toContain('Summer banner');

    // Payout run: each partner's own approved balance.
    const p1 = await partner('active');
    const p2 = await partner('active');
    for (const [id, amount] of [[p1.id, '12.5000'], [p2.id, '30.0000']] as const) {
      await query(
        `INSERT INTO ledger_entries (network_id, account_type, account_id, entry_type, direction, amount, currency, status, idempotency_key)
         VALUES ($1, 'publisher', $2, 'earning', 'credit', $3, 'USD', 'approved', $4)`,
        [fx.networkA, id, amount, `test:${randomUUID()}`]);
    }
    mail.sent.length = 0;
    const run = await request(dash).post('/api/finance/payouts/batches').set(admin).send({ publisherIds: [p1.id, p2.id], currency: 'USD', note: 'October' });
    expect(run.status).toBe(201);
    expect(await until(() => mailsTo(p1.email).length === 1 && mailsTo(p2.email).length === 1)).toBe(true);
    expect(mailsTo(p1.email)[0]!.subject).toContain('12.5000 USD');
    expect(mailsTo(p2.email)[0]!.subject).toContain('30.0000 USD');
    expect(mailsTo(p1.email)[0]!.html).toContain('October');
  });
});

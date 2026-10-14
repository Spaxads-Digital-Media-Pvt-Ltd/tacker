/**
 * Transactional email — on a real Postgres (INTEGRATION_DB=1, as in CI) with SMTP mocked at nodemailer
 * so the real mailer runs — audit F-24.
 *
 * The platform's own emails (offer details shared, partner / advertiser invoice issued, outstanding
 * balance request; portal invites are covered in portal-invite.test.ts) go to the recipient's contact
 * address through the network's SMTP — only while the network's Communication Hub toggle for that
 * email is on. A toggle that's off, no address, or SMTP that isn't configured is a clean no-op the
 * response explains; the action itself (the share, the invoice, the request) always completes.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const smtp = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: Record<string, unknown>) => { smtp.sent.push(m); return { messageId: randomUUID() }; },
    }),
  },
}));

// Emails go through the queue (O11): delivered in-process here.
vi.mock('../../src/lib/queues.js', async (importOriginal) => (await import('../helpers/inline-email-queue.js')).inlineEmailQueue(importOriginal));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('transactional email + Communication Hub toggles (live DB, mock SMTP)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;
  let netName: string;
  const partnerEmail = `partner-${randomUUID().slice(0, 6)}@example.com`;
  const advertiserEmail = `billing-${randomUUID().slice(0, 6)}@example.com`;
  const mailTo = (addr: string) => smtp.sent.filter((m) => m['to'] === addr);
  const toggle = (key: string, enabled: boolean, auth = admin) =>
    request(dash).put(`/api/communication-hub/system-emails/${key}`).set(auth).send({ enabled });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`txmail-${randomUUID().slice(0, 8)}`);
    await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [fx.networkA, JSON.stringify({
      smtp: { host: 'smtp.example.test', port: 587, username: 'mailer', password: 'legacy-plain', fromEmail: 'noreply@example.test' },
    })]);
    await query('UPDATE publishers SET contact_email = $2 WHERE id = $1', [fx.pubA1, partnerEmail]);
    await query('UPDATE advertisers SET contact_email = $2 WHERE id = $1', [fx.advA, advertiserEmail]);
    netName = (await query<{ name: string }>('SELECT name FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.name;
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });
  beforeEach(() => { smtp.sent.length = 0; });

  it('the Communication Hub list shows only system emails that are actually sent (O11)', async () => {
    const res = await request(dash).get('/api/communication-hub/system-emails').set(admin);
    const byKey = Object.fromEntries((res.body.data as { key: string; enabled: boolean; wired: boolean }[]).map((e) => [e.key, e]));
    for (const key of ['partner_portal_invite', 'advertiser_portal_invite', 'partner_balance_request', 'offer_details_shared', 'partner_invoice_generated', 'advertiser_invoice_generated']) {
      expect(byKey[key]).toMatchObject({ enabled: true, wired: true });
    }
    // Unwired ones are hidden rather than shown as toggles that do nothing.
    expect(byKey['new_conversion_recorded']).toBeUndefined();
    expect(byKey['advertiser_postback_received']).toBeUndefined();
  });

  it('Offer Details Shared: emailed to the partner; with the toggle off it is not, and the response says why', async () => {
    const share = () => request(dash).post('/api/offers/share-details').set(admin).send({ publisherId: fx.pubA1, offerIds: [fx.offerA] });
    const offerName = (await query<{ name: string }>('SELECT name FROM offers WHERE id = $1', [fx.offerA])).rows[0]!.name;

    const on = await share();
    expect(on.status).toBe(200);
    expect(on.body.data.email).toEqual({ sent: true, queued: true, recipients: [partnerEmail] });
    const [mail] = mailTo(partnerEmail);
    expect(mail!['subject']).toBe(`${netName}: offer details — ${offerName}`);
    expect(mail!['html']).toContain(`<strong>${offerName}</strong>`);
    expect(mail!['html']).toContain('Payout: 5.0000 USD'); // the offer default (no partner override), exact text

    expect((await toggle('offer_details_shared', false)).status).toBe(200);
    const off = await share();
    expect(off.status).toBe(200); // the share itself still happens (audited)
    expect(off.body.data.email).toMatchObject({ sent: false, skipped: 'disabled', reason: expect.stringMatching(/turned off in Communication Hub/) });
    expect(mailTo(partnerEmail)).toHaveLength(1);
    const audits = await query(`SELECT 1 FROM audit_log WHERE network_id = $1 AND entity_id = $2 AND action = 'offer.share_details'`, [fx.networkA, fx.offerA]);
    expect(audits.rowCount).toBe(2);
    await toggle('offer_details_shared', true);
  });

  it('Partner Invoice Generated: a visible invoice is emailed (notes escaped); hidden → no email; toggle off → none', async () => {
    const create = (body: Record<string, unknown>) => request(dash).post('/api/partner-invoices').set(admin).send({ publisherId: fx.pubA1, ...body });

    const visible = await create({ periodStart: '2026-01-01', periodEnd: '2026-01-31', paymentTerms: 'Net 30', publicNotes: 'Thanks <b>team</b>' });
    expect(visible.status).toBe(201);
    const inv = visible.body.data;
    expect(inv.email).toEqual({ sent: true, queued: true, recipients: [partnerEmail] });
    const [mail] = mailTo(partnerEmail);
    expect(mail!['subject']).toBe(`${netName}: invoice${inv.ref != null ? ` #${inv.ref}` : ''} for 2026-01-01 – 2026-01-31`);
    expect(mail!['html']).toContain(`Amount: ${inv.billedAmount} ${inv.currency}`);
    expect(mail!['html']).toContain('Payment terms: Net 30');
    expect(mail!['html']).toContain('Thanks &lt;b&gt;team&lt;/b&gt;');
    expect(mail!['html']).not.toContain('<b>team</b>');

    const hidden = await create({ periodStart: '2026-02-01', periodEnd: '2026-02-28', visibleToPartner: false });
    expect(hidden.status).toBe(201);
    expect(hidden.body.data.email).toBeNull();

    await toggle('partner_invoice_generated', false);
    const off = await create({ periodStart: '2026-03-01', periodEnd: '2026-03-31' });
    expect(off.status).toBe(201);
    expect(off.body.data.email).toMatchObject({ sent: false, skipped: 'disabled' });
    await toggle('partner_invoice_generated', true);

    // No contact address → nothing to send to.
    const noAddr = await request(dash).post('/api/partner-invoices').set(admin).send({ publisherId: fx.pubA2, periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    expect(noAddr.status).toBe(201);
    expect(noAddr.body.data.email).toMatchObject({ sent: false, skipped: 'no_recipients' });
    expect(mailTo(partnerEmail)).toHaveLength(1);
  });

  it('Advertiser Invoice Generated: emailed without the (possibly internal) notes', async () => {
    const res = await request(dash).post('/api/advertiser-invoices').set(admin)
      .send({ advertiserId: fx.advA, periodStart: '2026-01-01', periodEnd: '2026-01-31', notes: 'internal: our margin is 40%' });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toEqual({ sent: true, queued: true, recipients: [advertiserEmail] });
    const [mail] = mailTo(advertiserEmail);
    expect(mail!['html']).toContain(`Amount: ${res.body.data.billedAmount} ${res.body.data.currency}`);
    expect(mail!['html']).not.toContain('margin is 40%');
  });

  it('Outstanding Balance Request: a partner with an approved balance is emailed it; a zero balance is not; toggle off → none', async () => {
    await query(
      `INSERT INTO ledger_entries (network_id, account_type, account_id, entry_type, direction, amount, currency, status, idempotency_key)
       VALUES ($1, 'publisher', $2, 'earning', 'credit', 42.5, 'USD', 'approved', $3)`, [fx.networkA, fx.pubA1, `test:${randomUUID()}`]);
    const ask = () => request(dash).post('/api/publishers/request-balances').set(admin).send({ publisherIds: [fx.pubA1, fx.pubA2] });

    const res = await ask();
    expect(res.status).toBe(200);
    const [a1, a2] = res.body.data.requested as { publisherId: string; email: Record<string, unknown> | null }[];
    expect(a1).toMatchObject({ publisherId: fx.pubA1, email: { sent: true, recipients: [partnerEmail] } });
    expect(a2).toMatchObject({ publisherId: fx.pubA2, email: null });
    const [mail] = mailTo(partnerEmail);
    expect(mail!['subject']).toBe(`Your outstanding balance with ${netName}`);
    expect(mail!['html']).toContain('<li>42.5000 USD</li>');

    await toggle('partner_balance_request', false);
    const off = await ask();
    expect(off.body.data.requested[0].email).toMatchObject({ sent: false, skipped: 'disabled' });
    expect(mailTo(partnerEmail)).toHaveLength(1);
    const audit = await query<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_log WHERE network_id = $1 AND entity_id = $2 AND action = 'publisher.request_balance' ORDER BY created_at DESC LIMIT 1`,
      [fx.networkA, fx.pubA1]);
    expect(audit.rows[0]!.after).toMatchObject({ emailed: false, emailSkipped: 'disabled' });
    await toggle('partner_balance_request', true);
  });

  it("SMTP not configured → the response says so (and the invoice still exists)", async () => {
    const adminB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
    await query('UPDATE publishers SET contact_email = $2 WHERE id = $1', [fx.pubB1, `b-${randomUUID().slice(0, 6)}@example.com`]);
    const res = await request(dash).post('/api/partner-invoices').set(adminB).send({ publisherId: fx.pubB1, periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toMatchObject({ sent: false, skipped: 'smtp_not_configured', reason: expect.stringMatching(/SMTP is not fully configured/) });
    expect(smtp.sent).toHaveLength(0);
  });

  it("toggling a system email is admin-only, and one network's toggle doesn't affect another's", async () => {
    const manager = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'manager' }));
    expect((await toggle('offer_details_shared', false, manager)).status).toBe(403);
    const adminB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
    expect((await toggle('offer_details_shared', false, adminB)).status).toBe(200);
    const share = await request(dash).post('/api/offers/share-details').set(admin).send({ publisherId: fx.pubA1, offerIds: [fx.offerA] });
    expect(share.body.data.email).toMatchObject({ sent: true });
  });
});

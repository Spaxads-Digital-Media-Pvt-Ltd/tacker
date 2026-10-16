/**
 * The platform's email — on a real Postgres (INTEGRATION_DB=1); the SMTP faked, the email queue in-process.
 *
 * - Settings: the password is stored encrypted and never returned; a test email.
 * - Notifications: a new ticket → its agent; an answer → the customer; a demo request → the salesperson; an
 *   invoice → the network's owner; a toggle off sends nothing; no SMTP sends nothing.
 * - The platform's email log lists them (never in a network's own email log).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const mail = vi.hoisted(() => ({ configured: true, sent: [] as { to: string[]; subject: string; html: string }[] }));
vi.mock('../../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/mailer.js')>();
  return {
    ...actual,
    platformSmtpConfigError: async () => (mail.configured ? null : 'not set up'),
    sendPlatformEmail: async (to: string[], subject: string, html: string) => {
      mail.sent.push({ to, subject, html });
      return { sent: to.length, results: to.map((recipient) => ({ recipient, ok: true })) };
    },
  };
});
vi.mock('../../src/lib/queues.js', async (io) => (await import('../helpers/inline-email-queue.js')).inlineEmailQueue(io));

import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003', support: '00000000-0000-4000-a000-000000000005' };
const waitFor = async (pred: () => boolean, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { if (pred()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

d('platform email (live DB)', () => {
  let platform: Express;
  let dash: Express;
  let fx: Fixture;
  let owner: Record<string, string>;
  let staffA: Record<string, string>;
  let ownerEmail: string;
  const staff = async (roleId: string) => {
    const id = randomUUID(); const email = `em-${id.slice(0, 8)}@team.test`;
    await query(`INSERT INTO platform_admins (id, email, name, status, auth_provider, password_hash, role_id) VALUES ($1, $2, $3, 'active', 'local', $4, $5)`,
      [id, email, `Em ${id.slice(0, 4)}`, await hashPassword(`pw-${id}`), roleId]);
    return { id, email, auth: bearer(await signPlatformAdminToken(id)) };
  };
  const settings = (notify: Record<string, boolean> = {}) => ({
    host: 'smtp.test', port: 587, secure: false, username: 'platform', fromEmail: 'noreply@platform.test', fromName: 'Platform',
    notify: { ticketCreated: true, customerReply: true, staffReply: true, leadInbound: true, taskAssigned: true, invoiceIssued: true, invoiceOverdue: true, networkSuspended: true, ...notify },
  });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`email-${randomUUID().slice(0, 8)}`);
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    owner = (await staff(ROLE.owner)).auth;
    const auth = randomUUID(); ownerEmail = `owner-${auth.slice(0, 6)}@net.test`;
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, 'Olive', 'admin', 'active')`, [fx.networkA, auth, ownerEmail]);
    staffA = bearer(operatorToken({ userId: auth, networkId: fx.networkA }));
  });

  it('settings: the password is encrypted and never returned; a test email', async () => {
    const put = await request(platform).put('/platform/settings/email').set(owner).send({ ...settings(), password: 's3cret-pass' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data).toMatchObject({ hasPassword: true, configError: null });
    expect(put.body.data).not.toHaveProperty('password');
    const stored = (await query<{ value: { password: string } }>(`SELECT value FROM platform_settings WHERE key = 'email'`)).rows[0]!.value;
    expect(stored.password).toMatch(/^enc:/);
    // Saving without a password keeps it.
    await request(platform).put('/platform/settings/email').set(owner).send(settings());
    expect((await query<{ value: { password: string } }>(`SELECT value FROM platform_settings WHERE key = 'email'`)).rows[0]!.value.password).toBe(stored.password);
    const test = await request(platform).post('/platform/settings/email/test').set(owner).send({ to: 'me@platform.test' });
    expect(test.body.data).toEqual({ sent: true, error: null });
    expect(mail.sent.at(-1)!.to).toEqual(['me@platform.test']);
  });

  it('notifications: ticket → agent, answer → customer, demo → salesperson, invoice → owner; toggles and no-SMTP', async () => {
    const agent = await staff(ROLE.support);
    const paused = (await query<{ id: string }>(`UPDATE platform_admins SET status = 'disabled' WHERE role_id = $1 AND id <> $2 AND status = 'active' RETURNING id`, [ROLE.support, agent.id])).rows.map((r) => r.id);
    const pausedSales = (await query<{ id: string }>(`UPDATE platform_admins SET status = 'disabled' WHERE role_id = $1 AND status = 'active' RETURNING id`, [ROLE.sales])).rows.map((r) => r.id);
    const seller = await staff(ROLE.sales);
    try {
      const t = await request(dash).post('/api/support/tickets').set(staffA).send({ subject: 'Clicks missing', body: 'Since noon' });
      expect(await waitFor(() => mail.sent.some((m) => m.to.includes(agent.email) && m.subject.startsWith(`[#${t.body.data.number}] Net A`) && m.subject.endsWith(': Clicks missing')))).toBe(true);
      await request(platform).post(`/platform/support/tickets/${t.body.data.id}/messages`).set(agent.auth).send({ body: 'Fixed — retry now.' });
      expect(await waitFor(() => mail.sent.some((m) => m.to.includes(ownerEmail) && m.subject === `Re: [#${t.body.data.number}] Clicks missing` && m.html.includes('Fixed — retry now.')))).toBe(true);

      const company = `Mail Co ${randomUUID().slice(0, 4)}`;
      await request(dash).post('/api/signup/demo').send({ name: 'Dan', email: `dan-${randomUUID().slice(0, 6)}@m.test`, company });
      expect(await waitFor(() => mail.sent.some((m) => m.to.includes(seller.email) && m.subject === `New demo request: ${company}`))).toBe(true);

      const inv = await request(platform).post(`/platform/networks/${fx.networkA}/invoices`).set(owner).send({ description: 'Setup', amount: '25.00' });
      expect(await waitFor(() => mail.sent.some((m) => m.to.includes(ownerEmail) && m.subject.startsWith(`Invoice ${inv.body.data.number}`)))).toBe(true);
      // Escaped: a network name with markup arrives as text.
      expect(mail.sent.find((m) => m.subject.startsWith(`Invoice ${inv.body.data.number}`))!.html).not.toMatch(/<script/i);

      // Toggle off → nothing.
      await request(platform).put('/platform/settings/email').set(owner).send(settings({ invoiceIssued: false }));
      const before = mail.sent.length;
      await request(platform).post(`/platform/networks/${fx.networkA}/invoices`).set(owner).send({ description: 'Off', amount: '1.00' });
      await new Promise((r) => setTimeout(r, 300));
      expect(mail.sent.length).toBe(before);
      // No SMTP → nothing queued at all.
      await request(platform).put('/platform/settings/email').set(owner).send(settings());
      mail.configured = false;
      const rowsBefore = (await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM email_outbox WHERE network_id IS NULL')).rows[0]!.n;
      await request(platform).post(`/platform/networks/${fx.networkA}/invoices`).set(owner).send({ description: 'No smtp', amount: '1.00' });
      await new Promise((r) => setTimeout(r, 300));
      expect((await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM email_outbox WHERE network_id IS NULL')).rows[0]!.n).toBe(rowsBefore);
      mail.configured = true;
    } finally {
      await query(`UPDATE platform_admins SET status = 'active' WHERE id = ANY($1::uuid[])`, [[...paused, ...pausedSales]]);
    }
  });

  it('the platform email log; never in a network’s own log', async () => {
    const log = (await request(platform).get('/platform/emails').set(owner)).body.data as { recipient: string; status: string; event: string; network_name: string | null }[];
    expect(log.find((r) => r.recipient === ownerEmail && r.event === 'billing.invoice_issued')).toMatchObject({ status: 'sent', network_name: expect.any(String) });
    const tenantLog = await request(dash).get('/api/communication-hub/email-log').set(staffA);
    expect(tenantLog.status).toBe(200);
    expect((tenantLog.body.data.rows as { recipient: string }[]).some((r) => r.recipient === ownerEmail)).toBe(false);
    await query(`DELETE FROM platform_settings WHERE key = 'email'`);
  });
});

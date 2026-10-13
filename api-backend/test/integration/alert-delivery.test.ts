/**
 * Raised fraud alerts are delivered — on a real Postgres (INTEGRATION_DB=1, as in CI) — audit F-23.
 * The mailer is mocked; the webhook goes through the real SSRF guard unless a case stubs a response.
 *
 * A NEW alert from the fraud scan goes to the network's alert emails and webhook once (a still-open
 * alert isn't re-sent), and the outcome is recorded on the alert (metadata.delivery). A webhook that
 * resolves to a private address is refused and recorded as such; SMTP trouble is recorded, not thrown.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/lib/mailer.js', () => ({
  sendNetworkEmail: vi.fn(async (_networkId: string, recipients: string[]) => ({
    sent: recipients.length, results: recipients.map((recipient) => ({ recipient, ok: true })),
  })),
}));
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return { ...actual, safeRequest: vi.fn(actual.safeRequest) };
});

import { sendNetworkEmail } from '../../src/lib/mailer.js';
import { safeRequest } from '../../src/lib/net/safe-http.js';
import { runFraudScan } from '../../src/lib/fraud/scan.js';
import { setFraudConfig } from '../../src/lib/fraud/rules.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('fraud alert delivery (live DB)', () => {
  const mail = vi.mocked(sendNetworkEmail);
  const hook = vi.mocked(safeRequest);

  /** 25 datacenter clicks for pubA1 → the scan raises one high_datacenter_traffic alert. */
  const datacenterTraffic = async (fx: Fixture) => query(
    `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, fraud_flags)
     SELECT $4 || g, $1, $2, $3, '{datacenter_ip}' FROM generate_series(1, 25) g`,
    [fx.networkA, fx.offerA, fx.pubA1, `f23-${randomUUID().slice(0, 8)}-`]);
  const alertOf = async (fx: Fixture) => (await query<{ id: string; metadata: Record<string, unknown> }>(
    `SELECT id, metadata FROM alerts WHERE network_id = $1 AND type = 'high_datacenter_traffic'`, [fx.networkA])).rows;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
  });
  beforeEach(() => { mail.mockClear(); hook.mockClear(); });

  it('a new alert is emailed and POSTed to the webhook once, and the outcome is recorded on the alert', async () => {
    const fx = await seedFixture(`deliver-${randomUUID().slice(0, 8)}`);
    await setFraudConfig(fx.networkA, { alertEmails: ['ops@example.com'], alertWebhookUrl: 'https://hooks.example.com/services/T00/s3cr3t' });
    await datacenterTraffic(fx);
    hook.mockResolvedValueOnce({ status: 200, body: 'ok' });

    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(1);
    const [alert] = await alertOf(fx);

    expect(mail).toHaveBeenCalledTimes(1);
    const [netId, to, subject, html] = mail.mock.calls[0]!;
    expect([netId, to]).toEqual([fx.networkA, ['ops@example.com']]);
    expect(subject).toBe('[Tracker] HIGH alert: High datacenter traffic');
    expect(html).toContain('100% of 25 clicks came from datacenter IPs.');
    expect(html).toContain(fx.pubA1);

    expect(hook).toHaveBeenCalledTimes(1);
    const [url, opts] = hook.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.com/services/T00/s3cr3t'); // decrypted for sending
    expect(opts).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(opts.body!)).toMatchObject({
      event: 'alert.raised',
      alert: { id: alert!.id, type: 'high_datacenter_traffic', severity: 'high', entityType: 'publisher', entityId: fx.pubA1, metadata: { clicks: 25, datacenter: 25 } },
    });

    expect(alert!.metadata['delivery']).toMatchObject({ email: { sent: 1, failed: 0 }, webhook: { ok: true, status: 200 } });
    expect(alert!.metadata).toMatchObject({ clicks: 25, datacenter: 25 }); // the alert's own metadata is kept

    // Still open → the next scan doesn't raise or send it again.
    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(0);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('a webhook that resolves to a private address is refused by the SSRF guard and recorded', async () => {
    const fx = await seedFixture(`deliver-ssrf-${randomUUID().slice(0, 8)}`);
    await setFraudConfig(fx.networkA, { alertWebhookUrl: 'http://localhost:9/hook' });
    await datacenterTraffic(fx);
    await runFraudScan(fx.networkA);
    expect(hook).toHaveBeenCalledTimes(1); // the real guard ran
    expect(mail).not.toHaveBeenCalled();
    const [alert] = await alertOf(fx);
    expect(alert!.metadata['delivery']).toMatchObject({ webhook: { ok: false, error: 'blocked_destination: private_address' } });
    expect(alert!.metadata['delivery']).not.toHaveProperty('email');
  });

  it("SMTP that isn't configured, or a receiver answering non-2xx, is recorded — not thrown", async () => {
    const fx = await seedFixture(`deliver-fail-${randomUUID().slice(0, 8)}`);
    await setFraudConfig(fx.networkA, { alertEmails: ['a@example.com', 'b@example.com'], alertWebhookUrl: 'https://hooks.example.com/x' });
    await datacenterTraffic(fx);
    mail.mockResolvedValueOnce({ sent: 0, results: [], configError: 'SMTP is not fully configured yet' });
    hook.mockResolvedValueOnce({ status: 500, body: 'boom' });
    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(1);
    const [alert] = await alertOf(fx);
    expect(alert!.metadata['delivery']).toMatchObject({
      email: { sent: 0, failed: 2, error: 'SMTP is not fully configured yet' },
      webhook: { ok: false, status: 500 },
    });
  });

  it('with no channels configured nothing is sent and the alert carries no delivery record', async () => {
    const fx = await seedFixture(`deliver-none-${randomUUID().slice(0, 8)}`);
    await datacenterTraffic(fx);
    expect((await runFraudScan(fx.networkA)).alertsRaised).toBe(1);
    expect(mail).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect((await alertOf(fx))[0]!.metadata).not.toHaveProperty('delivery');
  });
});

/**
 * Fire a single test/debug postback with sample macros filled in and report the result. Shared by
 * the publisher "Postback Test" and advertiser "Debug Postback" screens. Never touches the ledger
 * or records a conversion — it's a pure connectivity check.
 */
import { substituteMacros } from '../../surfaces/tracking/macros.js';

export interface PostbackTestResult {
  ok: boolean;
  status: number | null;
  ms: number;
  finalUrl: string;
  error: string | null;
  /** First ~500 chars of the response body — shows WHY a call failed (e.g. Trackog's 400 message). */
  body: string | null;
}

const TIMEOUT_MS = 10_000;

/** Sample macro values used when testing a postback URL template. */
export function sampleMacros(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    click_id: 'test_click_0000000000000000',
    conversion_id: 'test_conv_0000000000000000',
    offer_id: 'test-offer', publisher_id: 'test-publisher', advertiser_id: 'test-advertiser',
    event: 'purchase', payout: '5.0000', revenue: '8.0000', currency: 'USD',
    txn_id: 'test-txn-123',
    country: 'US', geo: 'US', device: 'desktop', os: 'Windows', browser: 'Chrome',
    sub1: 's1', sub2: 's2', sub3: 's3', sub4: 's4', sub5: 's5',
    ...overrides,
  };
}

export async function firePostbackTest(
  urlTemplate: string, method: 'GET' | 'POST', macros: Record<string, string>,
): Promise<PostbackTestResult> {
  const finalUrl = substituteMacros(urlTemplate, macros);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(finalUrl, {
      method,
      signal: ctrl.signal,
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(macros) }
        : {}),
    });
    const bodyText = await res.text().catch(() => '');
    const body = bodyText ? bodyText.slice(0, 500) : null;
    return { ok: res.status >= 200 && res.status < 300, status: res.status, ms: Date.now() - started, finalUrl, error: null, body };
  } catch (err) {
    const e = err as Error;
    return { ok: false, status: null, ms: Date.now() - started, finalUrl, error: e.name === 'AbortError' ? 'timeout' : e.message, body: null };
  } finally {
    clearTimeout(timer);
  }
}

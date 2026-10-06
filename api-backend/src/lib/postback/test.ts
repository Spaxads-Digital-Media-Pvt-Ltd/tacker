/**
 * Fire a single test/debug postback with sample macros filled in and report the result. Shared by
 * the publisher "Postback Test" and advertiser "Debug Postback" screens. Never touches the ledger
 * or records a conversion — it's a pure connectivity check.
 */
import { substituteMacros } from '../../surfaces/tracking/macros.js';
import { BlockedDestinationError, safeRequest } from '../net/safe-http.js';

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
  const started = Date.now();
  try {
    const res = await safeRequest(finalUrl, {
      method,
      timeoutMs: TIMEOUT_MS,
      maxBodyBytes: 500,
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(macros) }
        : {}),
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, ms: Date.now() - started, finalUrl, error: null, body: res.body || null };
  } catch (err) {
    const e = err as Error;
    const error = e instanceof BlockedDestinationError
      ? 'Blocked: postbacks can only be sent to public internet addresses.'
      : e.name === 'AbortError' ? 'timeout' : e.message;
    return { ok: false, status: null, ms: Date.now() - started, finalUrl, error, body: null };
  }
}

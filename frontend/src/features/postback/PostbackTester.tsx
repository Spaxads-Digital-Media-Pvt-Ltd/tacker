/**
 * Postback tester panel — fires a URL template (with sample macros filled by the backend) and shows
 * the result. Reused by the publisher "Postback Test" and advertiser "Debug Postback" tabs. The
 * `testPath` is the backend endpoint that performs the fire (e.g. /api/publishers/:id/postbacks/test).
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { Field } from '../../shared-components/primitives/ui';
import { countryOptions } from '../../data/geo';

const EXAMPLE_HOST = 'example.com';
const EXAMPLE_URL = `https://${EXAMPLE_HOST}/pb?cid={click_id}&payout={payout}&txn={txn_id}&geo={country}&device={device}`;

interface TestResult { ok: boolean; status: number | null; ms: number; finalUrl: string; error: string | null; body: string | null }

const COUNTRIES = countryOptions();
const DEVICES = ['desktop', 'mobile', 'tablet'];

function isExampleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === EXAMPLE_HOST;
  } catch { return false; }
}

export function PostbackTester({ testPath, hint }: { testPath: string; hint?: string }) {
  const [url, setUrl] = useState(EXAMPLE_URL);
  const [method, setMethod] = useState('GET');
  const [country, setCountry] = useState('US');
  const [device, setDevice] = useState('desktop');
  const [result, setResult] = useState<TestResult | null>(null);
  const [skipSend, setSkipSend] = useState(false);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<TestResult>(testPath, body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (isExampleUrl(url)) {
      setSkipSend(true);
      return;
    }
    setSkipSend(false);
    const res = await run({ url, method, country, device });
    if (res) setResult(res);
  };

  const clearPlaceholder = () => { setUrl(''); setSkipSend(false); };

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-small text-fg-secondary">
        {hint ?? 'Fire a test call with sample macros ({click_id}, {payout}, {txn_id}, {country}, {device}, …) to verify connectivity. No conversion is recorded.'}
      </p>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Postback URL (with macros)">
          <div className="relative">
            <input
              className={`input font-mono text-sm ${skipSend ? '!border-warning' : ''}`}
              value={url}
              onChange={(e) => { setUrl(e.target.value); if (skipSend) setSkipSend(false); }}
              required
              placeholder="https://your-advertiser.com/pb?click_id={click_id}&payout={payout}"
            />
            {skipSend && (
              <button type="button" onClick={clearPlaceholder} className="absolute right-2 top-1/2 -translate-y-1/2 text-tiny text-fg-muted hover:text-fg underline">
                Clear
              </button>
            )}
          </div>
          {skipSend && (
            <p className="mt-1.5 text-tiny text-warning flex items-start gap-1.5">
              <span>This is a placeholder example URL (example.com). Replace it with your real advertiser postback endpoint before testing.</span>
            </p>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>GET</option><option>POST</option>
            </select>
          </Field>
          <Field label="GEO (country)">
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Device">
            <select className="input" value={device} onChange={(e) => setDevice(e.target.value)}>
              {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Firing…' : 'Send test'}</button>
      </form>

      {skipSend && !result && (
        <div className="card !border-warning">
          <p className="text-small text-warning font-medium">Example URL — not tested</p>
          <p className="mt-1 text-tiny text-fg-secondary">Paste a real advertiser postback URL above and click <strong>Send test</strong> to verify connectivity.</p>
        </div>
      )}

      {result && (
        <div className={`card border ${result.ok ? 'border-success' : 'border-danger'}`}>
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold ${result.ok ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'}`}>
              {result.ok ? 'Success' : 'Failed'}
            </span>
            <span className="text-small text-fg">HTTP {result.status ?? '—'} · {result.ms} ms</span>
          </div>
          {result.error && <p className="mt-2 text-small text-danger-text">Error: {result.error}</p>}
          {result.body && (
            <div className="mt-2">
              <p className="text-tiny font-semibold text-fg-secondary">Response body (why it {result.ok ? 'passed' : 'failed'}):</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-page p-2 font-mono text-tiny text-fg">{result.body}</pre>
            </div>
          )}
          <p className="mt-2 break-all font-mono text-tiny text-fg-secondary">{result.finalUrl}</p>
        </div>
      )}
    </div>
  );
}

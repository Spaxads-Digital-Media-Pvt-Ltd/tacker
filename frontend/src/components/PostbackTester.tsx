/**
 * Postback tester panel — fires a URL template (with sample macros filled by the backend) and shows
 * the result. Reused by the publisher "Postback Test" and advertiser "Debug Postback" tabs. The
 * `testPath` is the backend endpoint that performs the fire (e.g. /api/publishers/:id/postbacks/test).
 */
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useMutation } from '../lib/useApi';
import { Field } from './ui';

interface TestResult { ok: boolean; status: number | null; ms: number; finalUrl: string; error: string | null; body: string | null }

const COUNTRIES = ['US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR', 'BR', 'JP', 'SG'];
const DEVICES = ['desktop', 'mobile', 'tablet'];

export function PostbackTester({ testPath, hint }: { testPath: string; hint?: string }) {
  const [url, setUrl] = useState('https://example.com/pb?cid={click_id}&payout={payout}&txn={txn_id}&geo={country}&device={device}');
  const [method, setMethod] = useState('GET');
  const [country, setCountry] = useState('US');
  const [device, setDevice] = useState('desktop');
  const [result, setResult] = useState<TestResult | null>(null);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<TestResult>(testPath, body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({ url, method, country, device });
    if (res) setResult(res);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-fg-secondary">
        {hint ?? 'Fire a test call with sample macros ({click_id}, {payout}, {txn_id}, {country}, {device}, …) to verify connectivity. No conversion is recorded.'}
      </p>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-sm text-danger-text">{error}</p>}
        <Field label="Postback URL (with macros)">
          <input className="input font-mono text-sm" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>GET</option><option>POST</option>
            </select>
          </Field>
          <Field label="GEO (country)">
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
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

      {result && (
        <div className={`card border ${result.ok ? 'border-success' : 'border-danger'}`}>
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${result.ok ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'}`}>
              {result.ok ? 'Success' : 'Failed'}
            </span>
            <span className="text-sm">HTTP {result.status ?? '—'} · {result.ms} ms</span>
          </div>
          {result.error && <p className="mt-2 text-sm text-danger-text">Error: {result.error}</p>}
          {result.body && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-fg-secondary">Response body (why it {result.ok ? 'passed' : 'failed'}):</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-subtle p-2 font-mono text-xs text-fg-secondary">{result.body}</pre>
            </div>
          )}
          <p className="mt-2 break-all font-mono text-xs text-fg-muted">{result.finalUrl}</p>
        </div>
      )}
    </div>
  );
}

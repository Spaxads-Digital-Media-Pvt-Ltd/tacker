/**
 * A quote's private page (/quote/:token, no sign-in) — the link a prospect gets by email. They read the
 * quote and accept it (typing their name) or decline it (optionally saying why), once, while it's valid
 * (GET / POST /api/public/quotes/:token[/respond]).
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Brandmark } from '../shared-components/primitives/Brandmark';
import { QuoteDocument, type QuoteDocumentData } from '../shared-components/panels/QuoteDocument';

type PublicQuote = QuoteDocumentData & { respondedAt: string | null; responderName: string | null };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error?.message ?? 'Something went wrong — try again.');
  return body.data as T;
}

export default function QuotePublic() {
  const { token = '' } = useParams<{ token: string }>();
  const [q, setQ] = useState<PublicQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<null | 'accept' | 'decline'>(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    call<PublicQuote>(`/api/public/quotes/${encodeURIComponent(token)}`).then(setQ).catch((e: Error) => setError(e.message));
  }, [token]);
  const respond = async () => {
    setBusy(true); setFormError(null);
    try {
      setQ(await call<PublicQuote>(`/api/public/quotes/${encodeURIComponent(token)}/respond`, {
        method: 'POST', body: JSON.stringify({ decision: mode, ...(name.trim() ? { name: name.trim() } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      }));
      setMode(null);
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-full bg-page p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between print:hidden"><Brandmark /><button className="btn-ghost" onClick={() => window.print()}>Print / Save as PDF</button></div>
        {error && <p className="card text-small text-danger-text">{error}</p>}
        {!q ? (!error && <p className="text-small text-fg-secondary">Loading…</p>) : (
          <QuoteDocument q={q}>
            <div className="border-t border-border pt-5 print:hidden">
              {q.status === 'accepted' && <p className="rounded-[var(--radius)] bg-success-bg px-4 py-3 text-small text-success-text">Accepted{q.responderName ? ` by ${q.responderName}` : ''}{q.respondedAt ? ` on ${new Date(q.respondedAt).toLocaleDateString()}` : ''}. Thank you — we’ll be in touch with the next steps.</p>}
              {q.status === 'declined' && <p className="rounded-[var(--radius)] bg-page px-4 py-3 text-small text-fg-secondary ring-1 ring-inset ring-border">This quote was declined{q.respondedAt ? ` on ${new Date(q.respondedAt).toLocaleDateString()}` : ''}.</p>}
              {q.status === 'expired' && <p className="rounded-[var(--radius)] bg-warning-bg px-4 py-3 text-small text-warning-text">This quote expired on {q.validUntil}. Reply to the email it came with for a new one.</p>}
              {q.status === 'sent' && !mode && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="mr-auto text-small text-fg-secondary">Valid until {q.validUntil}</span>
                  <button className="btn-ghost" onClick={() => setMode('decline')}>Decline</button>
                  <button className="btn-primary" onClick={() => setMode('accept')}>Accept quote</button>
                </div>
              )}
              {q.status === 'sent' && mode && (
                <div className="space-y-3">
                  {formError && <p className="text-small text-danger-text">{formError}</p>}
                  {mode === 'accept' ? (
                    <label className="block text-small text-fg">Type your full name to accept
                      <input className="input mt-1" autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                    </label>
                  ) : (
                    <label className="block text-small text-fg">Anything we should know? (optional)
                      <textarea className="input mt-1 min-h-[80px]" autoFocus maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                  )}
                  <div className="flex justify-end gap-3">
                    <button className="btn-ghost" onClick={() => { setMode(null); setFormError(null); }}>Back</button>
                    <button className={mode === 'accept' ? 'btn-primary' : 'btn-danger'} disabled={busy || (mode === 'accept' && !name.trim())} onClick={() => void respond()}>
                      {busy ? 'Sending…' : mode === 'accept' ? 'Accept' : 'Decline quote'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </QuoteDocument>
        )}
      </div>
    </div>
  );
}

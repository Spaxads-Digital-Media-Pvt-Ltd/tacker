/**
 * Super Admin › Settings › Email — the platform's SMTP (the password is write-only), a test email, which
 * notifications it sends (tickets, demo requests, tasks, invoices, overdue, suspension), and the log of what
 * it sent (retry a failed one).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import { Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';

interface S {
  host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName: string; hasPassword: boolean;
  notify: Record<string, boolean>; notifications: { key: string; label: string }[]; configError: string | null;
}
interface LogRow { id: string; event: string; recipient: string; subject: string; status: 'queued' | 'sent' | 'failed'; attempts: number; last_error: string | null; created_at: string; network_name: string | null }
type Form = { host: string; port: string; secure: boolean; username: string; fromEmail: string; fromName: string; notify: Record<string, boolean>; password: string };
const STATUS_CLS = { sent: 'bg-success-bg text-success-text', queued: 'bg-info-bg text-info-text', failed: 'bg-danger-bg text-danger-text' };

export function EmailSettings() {
  const canEdit = usePlatformMe().can('settings', 'full');
  const current = useQuery<S>('/platform/settings/email');
  const log = useQuery<LogRow[]>('/platform/emails', { limit: 30 });
  const [f, setF] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const m = useMutation((b: Record<string, unknown>) => api.put<S>('/platform/settings/email', b));
  const test = useMutation((to: string) => api.post<{ sent: boolean; error: string | null }>('/platform/settings/email/test', { to }));
  useEffect(() => {
    if (current.data) {
      const d = current.data;
      setF({ host: d.host, port: String(d.port), secure: d.secure, username: d.username, fromEmail: d.fromEmail, fromName: d.fromName, notify: d.notify, password: '' });
    }
  }, [current.data]);
  if (current.loading || (!f && !current.error)) return <StateBlock><Spinner /></StateBlock>;
  if (current.error || !f || !current.data) return <StateBlock>{current.error ?? 'Could not load the email settings'}</StateBlock>;
  const set = (k: string, v: unknown) => { setSaved(false); setF((s) => (s ? { ...s, [k]: v } : s)); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await m.run({ host: f.host.trim(), port: Number(f.port) || 587, secure: f.secure, username: f.username.trim(), fromEmail: f.fromEmail.trim(), fromName: f.fromName.trim(),
      notify: f.notify, ...(f.password ? { password: f.password } : {}) });
    if (out) { setSaved(true); current.refetch(); }
  };
  const runTest = async () => {
    setTestResult(null);
    const r = await test.run(testTo.trim());
    if (r) setTestResult(r.sent ? `Sent to ${testTo.trim()} — check the inbox.` : `Not sent: ${r.error}`);
  };
  const retry = async (id: string) => { try { await api.post(`/platform/emails/${id}/retry`, {}); log.refetch(); } catch { /* the row says why */ } };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className={`rounded-[var(--radius)] px-4 py-3 text-small ${current.data.configError ? 'bg-warning-bg text-warning-text' : 'bg-success-bg text-success-text'}`}>
        {current.data.configError ? `Not sending: ${current.data.configError}` : `Sending from ${current.data.fromName ? `${current.data.fromName} <${current.data.fromEmail}>` : current.data.fromEmail}.`}
      </div>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          {m.error && <p className="text-small text-danger-text">{m.error}</p>}
          {saved && <p className="text-small text-success-text">Saved.</p>}
          <div className="card space-y-4">
            <h3 className="text-h3 font-medium text-fg">SMTP</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2"><Field label="Host"><input className="input" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.postmarkapp.com" /></Field></div>
              <Field label="Port"><input className="input" inputMode="numeric" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="Username"><input className="input" autoComplete="off" value={f.username} onChange={(e) => set('username', e.target.value)} /></Field>
              <Field label="Password" hint={current.data.hasPassword ? 'Saved — leave blank to keep it' : 'Stored encrypted'}>
                <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder={current.data.hasPassword ? '••••••••' : ''} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-small text-fg"><input type="checkbox" checked={f.secure} onChange={(e) => set('secure', e.target.checked)} /> TLS from the start (port 465)</label>
              <Field label="From email"><input className="input" type="email" value={f.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} placeholder="support@your-platform.com" /></Field>
              <Field label="From name"><input className="input" value={f.fromName} onChange={(e) => set('fromName', e.target.value)} placeholder="Your platform" /></Field>
            </div>
          </div>
          <div className="card space-y-3">
            <h3 className="text-h3 font-medium text-fg">Notifications</h3>
            {current.data.notifications.map((n) => (
              <label key={n.key} className="flex items-center gap-2 text-small text-fg">
                <input type="checkbox" checked={f.notify[n.key] !== false} onChange={(e) => set('notify', { ...f.notify, [n.key]: e.target.checked })} />{n.label}
              </label>
            ))}
          </div>
          {canEdit && <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Save email settings'}</button></div>}
        </fieldset>
      </form>
      {canEdit && (
        <div className="card space-y-2">
          <h3 className="text-h3 font-medium text-fg">Send a test</h3>
          <div className="flex flex-wrap gap-2">
            <input className="input max-w-xs" type="email" placeholder="you@company.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <button type="button" className="btn-ghost" disabled={test.busy || !testTo.trim()} onClick={() => void runTest()}>{test.busy ? 'Sending…' : 'Send test email'}</button>
          </div>
          {(test.error || testResult) && <p className={`text-small ${test.error || testResult?.startsWith('Not') ? 'text-danger-text' : 'text-success-text'}`}>{test.error ?? testResult}</p>}
        </div>
      )}
      <div className="card !p-0">
        <h3 className="border-b border-border px-4 py-3 text-h3 font-medium text-fg">Sent by the platform</h3>
        {(log.data ?? []).length === 0 ? <p className="px-4 py-3 text-small text-fg-secondary">Nothing yet.</p> : (log.data ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-small last:border-0">
            <div className="min-w-0">
              <p className="truncate text-fg">{r.subject}</p>
              <p className="text-tiny text-fg-muted">{r.recipient}{r.network_name ? ` · ${r.network_name}` : ''} · {relTime(r.created_at)}{r.last_error ? ` · ${r.last_error}` : ''}</p>
            </div>
            <span className="flex items-center gap-2">
              <Chip className={STATUS_CLS[r.status]}>{r.status}</Chip>
              {r.status === 'failed' && canEdit && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => void retry(r.id)}>Retry</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

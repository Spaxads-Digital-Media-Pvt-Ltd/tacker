/**
 * Automation › Alerts and Webhooks forms. Alert rule conditions are built from clauses (metric, operator,
 * value), a scope and a window — written as the conditions text the API parses (lib/automationRules.ts);
 * a hand-written rule the builder can't show stays editable as text. Webhook events are checkboxes from
 * the API's own list. Deliveries shows a webhook's last 100 deliveries with Retry, and Send test event.
 * The vocabulary comes from GET /api/automation/meta, so the form can't offer what the worker won't read.
 */
import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { Field, Modal, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { buildConditions, buildEvents, DEFAULT_RULE, parseConditionsText, parseEvents, type RuleModel, type RuleOp } from '../../lib/automationRules';

export interface AutomationMeta {
  ruleMetrics: { key: string; label: string; kind: 'count' | 'percent' | 'money' | 'ratio' }[];
  ruleOps: RuleOp[];
  ruleScopes: ('offer' | 'partner' | 'advertiser')[];
  conditionsHelp: string;
  webhookEvents: string[];
}

export interface AlertRuleForm { id?: string; name: string; conditions: string; inApp: boolean; email: boolean }

const EVENT_LABEL: Record<string, string> = {
  'conversion.created': 'A conversion is recorded', 'conversion.approved': 'A conversion is approved',
  'conversion.rejected': 'A conversion is rejected', 'alert.raised': 'An alert is raised (fraud scan, alert rules)',
  'scheduled_action.executed': 'A scheduled action runs',
};

export function AlertRuleModal({ initial, onClose, onSaved }: { initial: AlertRuleForm | null; onClose: () => void; onSaved: () => void }) {
  const meta = useQuery<AutomationMeta>('/api/automation/meta');
  const parsed = initial ? parseConditionsText(initial.conditions) : DEFAULT_RULE;
  const [name, setName] = useState(initial?.name ?? '');
  const [model, setModel] = useState<RuleModel>(parsed ?? DEFAULT_RULE);
  const [asText, setAsText] = useState(initial != null && parsed == null);
  const [text, setText] = useState(initial?.conditions ?? '');
  const [inApp, setInApp] = useState(initial?.inApp ?? true);
  const [email, setEmail] = useState(initial?.email ?? false);
  const save = useMutation((body: Record<string, unknown>) =>
    (initial?.id ? api.patch(`/api/automation/alert-rules/${initial.id}`, body) : api.post('/api/automation/alert-rules', { ...body, status: 'active' })));

  const setClause = (i: number, patch: Partial<RuleModel['clauses'][number]>) =>
    setModel((m) => ({ ...m, clauses: m.clauses.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const conditions = asText ? text.trim() : buildConditions(model);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await save.run({ name: name.trim(), conditions, inApp, email })) { onSaved(); onClose(); }
  };

  const metrics = meta.data?.ruleMetrics ?? [];
  return (
    <Modal open size="xl" onClose={onClose} title={initial?.id ? `Edit alert rule: ${initial.name}` : 'New alert rule'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="alert-rule" className="btn-primary" disabled={save.busy || !name.trim() || !conditions}>{save.busy ? 'Saving…' : 'Save rule'}</button></>}>
      {meta.loading ? <StateBlock><Spinner /></StateBlock> : (
        <form id="alert-rule" onSubmit={submit} className="space-y-4">
          {save.error && <p className="text-small text-danger-text">{save.error}</p>}
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="e.g. Low CR on big offers" /></Field>
          {asText ? (
            <Field label="Conditions (text)">
              <textarea className="input min-h-[5rem] font-mono text-small" value={text} onChange={(e) => setText(e.target.value)} />
              <p className="mt-1 text-tiny text-fg-secondary">{meta.data?.conditionsHelp}</p>
              <button type="button" className="mt-1 text-tiny font-medium text-accent-text" onClick={() => { const m = parseConditionsText(text); if (m) { setModel(m); setAsText(false); } }}>Use the builder</button>
            </Field>
          ) : (
            <div className="space-y-2">
              <p className="label">Alert when all of these hold</p>
              {model.clauses.map((c, i) => {
                const kind = metrics.find((m) => m.key === c.metric)?.kind;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    {i > 0 && <span className="text-tiny font-semibold text-fg-secondary">AND</span>}
                    <select className="input !w-auto" value={c.metric} onChange={(e) => setClause(i, { metric: e.target.value })}>
                      {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <select className="input !w-20" value={c.op} onChange={(e) => setClause(i, { op: e.target.value as RuleOp })}>
                      {(meta.data?.ruleOps ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input className="input !w-32" inputMode="decimal" value={c.value} onChange={(e) => setClause(i, { value: e.target.value })}
                      placeholder={kind === 'percent' ? 'e.g. 5 (%)' : kind === 'count' ? 'e.g. 100' : 'e.g. 25.00'} />
                    {model.clauses.length > 1 && (
                      <button type="button" title="Remove condition" className="rounded p-1 text-fg-secondary hover:text-danger-text" onClick={() => setModel((m) => ({ ...m, clauses: m.clauses.filter((_, k) => k !== i) }))}><Trash2 size={14} /></button>
                    )}
                  </div>
                );
              })}
              {model.clauses.length < 5 && (
                <button type="button" className="inline-flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setModel((m) => ({ ...m, clauses: [...m.clauses, { metric: 'clicks', op: '>=', value: '' }] }))}><Plus size={12} /> Add condition</button>
              )}
              <div className="flex flex-wrap items-end gap-3 pt-2">
                <Field label="Checked">
                  <select className="input" value={model.scope ?? ''} onChange={(e) => setModel((m) => ({ ...m, scope: (e.target.value || null) as RuleModel['scope'] }))}>
                    <option value="">For the whole network</option>
                    {(meta.data?.ruleScopes ?? []).map((sc) => <option key={sc} value={sc}>Per {sc}</option>)}
                  </select>
                </Field>
                <Field label="Over the last">
                  <div className="flex gap-2">
                    <input className="input !w-20" type="number" min={1} value={model.window.amount} onChange={(e) => setModel((m) => ({ ...m, window: { ...m.window, amount: Math.max(1, Number(e.target.value) || 1) } }))} />
                    <select className="input !w-auto" value={model.window.unit} onChange={(e) => setModel((m) => ({ ...m, window: { ...m.window, unit: e.target.value as 'm' | 'h' | 'd' } }))}>
                      <option value="m">minutes</option><option value="h">hours</option><option value="d">days</option>
                    </select>
                  </div>
                </Field>
              </div>
              <p className="text-tiny text-fg-secondary">Saved as: <code className="font-mono">{conditions || '—'}</code> · <button type="button" className="font-medium text-accent-text" onClick={() => { setText(conditions); setAsText(true); }}>edit as text</button></p>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-small text-fg">
            <label className="flex items-center gap-2"><input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} className="h-4 w-4 rounded border-border" /> Notify in the app (Alerts)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4 rounded border-border" /> Email admins and managers</label>
          </div>
        </form>
      )}
    </Modal>
  );
}

export interface WebhookForm { id?: string; name: string; url: string; httpMethod: string; events: string }

export function WebhookModal({ initial, onClose, onSaved }: { initial: WebhookForm | null; onClose: () => void; onSaved: () => void }) {
  const meta = useQuery<AutomationMeta>('/api/automation/meta');
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [method, setMethod] = useState(initial?.httpMethod ?? 'POST');
  const [events, setEvents] = useState<string[]>(initial ? parseEvents(initial.events) : ['conversion.created']);
  const all = events.includes('*');
  const save = useMutation((body: Record<string, unknown>) =>
    (initial?.id ? api.patch(`/api/automation/webhooks/${initial.id}`, body) : api.post('/api/automation/webhooks', { ...body, status: 'active' })));
  const toggle = (ev: string) => setEvents((xs) => (xs.includes(ev) ? xs.filter((x) => x !== ev) : [...xs.filter((x) => x !== '*'), ev]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await save.run({ name: name.trim(), url: url.trim(), httpMethod: method, events: buildEvents(events) })) { onSaved(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={initial?.id ? `Edit webhook: ${initial.name}` : 'New webhook'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="webhook" className="btn-primary" disabled={save.busy || !name.trim() || !url.trim() || !events.length}>{save.busy ? 'Saving…' : 'Save webhook'}</button></>}>
      <form id="webhook" onSubmit={submit} className="space-y-4">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} /></Field>
        <Field label="URL"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} required maxLength={2000} placeholder="https://hooks.example.com/tracker" /></Field>
        <Field label="HTTP method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['POST', 'PUT', 'PATCH', 'GET', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="mt-1 text-tiny text-fg-secondary">POST / PUT / PATCH send the event as JSON; GET / DELETE add <code>event</code> and <code>delivery_id</code> to the URL.</p>
        </Field>
        <div>
          <p className="label">Send when</p>
          <label className="mb-1 flex items-center gap-2 text-small"><input type="checkbox" checked={all} onChange={() => setEvents(all ? [] : ['*'])} className="h-4 w-4 rounded border-border" /> Every event</label>
          {(meta.data?.webhookEvents ?? []).map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-small">
              <input type="checkbox" disabled={all} checked={all || events.includes(ev)} onChange={() => toggle(ev)} className="h-4 w-4 rounded border-border" />
              {EVENT_LABEL[ev] ?? ev} <code className="text-tiny text-fg-muted">{ev}</code>
            </label>
          ))}
        </div>
      </form>
    </Modal>
  );
}

interface Delivery { id: string; event: string; status: 'pending' | 'success' | 'failed' | 'blocked'; attempts: number; statusCode: number | null; error: string | null; createdAt: string; updatedAt: string }
const STATUS_TONE: Record<Delivery['status'], string> = { success: 'text-success-text', pending: 'text-fg-secondary', failed: 'text-danger-text', blocked: 'text-danger-text' };

export function DeliveriesModal({ webhook, onClose }: { webhook: { id: string; name: string }; onClose: () => void }) {
  const { data, loading, error, refetch } = useQuery<Delivery[]>(`/api/automation/webhooks/${webhook.id}/deliveries`);
  const retry = useMutation((d: string) => api.post(`/api/automation/webhooks/${webhook.id}/deliveries/${d}/retry`, {}));
  const test = useMutation(() => api.post(`/api/automation/webhooks/${webhook.id}/test`, {}));
  const [note, setNote] = useState<string | null>(null);
  return (
    <Modal open size="xl" onClose={onClose} title={`Deliveries: ${webhook.name}`}
      footer={<>
        <button type="button" className="btn-ghost mr-auto" disabled={test.busy} onClick={async () => { setNote(null); if (await test.run(undefined)) { setNote('Test event queued — refresh in a few seconds.'); setTimeout(refetch, 2500); } }}>Send test event</button>
        <button type="button" className="btn-ghost" onClick={() => refetch()}>Refresh</button>
        <button type="button" className="btn-primary" onClick={onClose}>Close</button>
      </>}>
      {(retry.error || test.error) && <p className="mb-2 text-small text-danger-text">{retry.error ?? test.error}</p>}
      {note && <p className="mb-2 text-small text-fg-secondary">{note}</p>}
      {loading && !data ? <StateBlock><Spinner /></StateBlock> : error ? <StateBlock>{error}</StateBlock> : !data?.length ? (
        <StateBlock>No deliveries yet — they appear here as events are sent (the last 100).</StateBlock>
      ) : (
        <div className="overflow-x-auto">
          <table className="premium-table">
            <thead><tr><th>Time</th><th>Event</th><th>Status</th><th className="text-right">Attempts</th><th>HTTP</th><th>Error</th><th /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap tabular-nums">{new Date(d.updatedAt).toLocaleString()}</td>
                  <td className="font-mono text-tiny">{d.event}</td>
                  <td className={`font-medium ${STATUS_TONE[d.status]}`}>{d.status}</td>
                  <td className="text-right tabular-nums">{d.attempts}</td>
                  <td className="tabular-nums">{d.statusCode ?? '—'}</td>
                  <td className="max-w-xs truncate text-small text-fg-secondary" title={d.error ?? undefined}>{d.error ?? '—'}</td>
                  <td className="text-right">
                    {(d.status === 'failed' || d.status === 'blocked') && (
                      <button type="button" className="text-tiny font-medium text-accent-text hover:underline" disabled={retry.busy}
                        onClick={async () => { if (await retry.run(d.id)) refetch(); }}>Retry</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

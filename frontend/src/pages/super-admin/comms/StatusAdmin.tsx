/**
 * Super Admin › Comms › Status page — the components customers see at /status and their state, incidents
 * with a timeline of updates (posting an update moves the incident on; "Resolved" closes it) and scheduled
 * maintenance.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Chip, Panel } from '../kit';
import { INCIDENT_STATE_LABEL, STATE_LABEL, STATE_TONE, type StatusIncident, type StatusPageData } from '../../../lib/platformComms';

function IncidentForm({ components, onClose, onSaved }: { components: StatusPageData['components']; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', impact: 'minor', status: 'investigating', componentIds: [] as string[], startsAt: '', message: '' });
  const save = useMutation((body: Record<string, unknown>) => api.post('/platform/status/incidents', body));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await save.run({ ...f, startsAt: f.startsAt || null })) onSaved(); };
  return (
    <Modal open onClose={onClose} title="New incident / maintenance"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="incident" className="btn-primary" disabled={save.busy}>Publish</button></>}>
      <form id="incident" onSubmit={submit} className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <Field label="Title"><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Impact"><select className="input" value={f.impact} onChange={(e) => setF((s) => ({ ...s, impact: e.target.value }))}>
            {['none', 'minor', 'major', 'critical', 'maintenance'].map((v) => <option key={v} value={v}>{v}</option>)}</select></Field>
          <Field label="State"><select className="input" value={f.status} onChange={(e) => setF((s) => ({ ...s, status: e.target.value }))}>
            {Object.entries(INCIDENT_STATE_LABEL).filter(([v]) => v !== 'resolved').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        {f.status === 'scheduled' && <Field label="Starts at"><input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => setF((s) => ({ ...s, startsAt: e.target.value }))} /></Field>}
        <div>
          <p className="label">Affected components</p>
          {components.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-small"><input type="checkbox" checked={f.componentIds.includes(c.id)} onChange={() => setF((s) => ({ ...s, componentIds: s.componentIds.includes(c.id) ? s.componentIds.filter((x) => x !== c.id) : [...s.componentIds, c.id] }))} />{c.name}</label>
          ))}
        </div>
        <Field label="First update (shown publicly)"><textarea className="input min-h-[5rem]" required maxLength={5000} value={f.message} onChange={(e) => setF((s) => ({ ...s, message: e.target.value }))} /></Field>
      </form>
    </Modal>
  );
}

function UpdateForm({ incident, onClose, onSaved }: { incident: StatusIncident; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(incident.status === 'scheduled' ? 'investigating' : incident.status);
  const [body, setBody] = useState('');
  const save = useMutation((b: Record<string, unknown>) => api.post(`/platform/status/incidents/${incident.id}/updates`, b));
  return (
    <Modal open onClose={onClose} title={`Update: ${incident.title}`}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={save.busy || !body.trim()} onClick={async () => { if (await save.run({ status, body: body.trim() })) onSaved(); }}>Post update</button></>}>
      {save.error && <p className="mb-2 text-small text-danger-text">{save.error}</p>}
      <Field label="State"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(INCIDENT_STATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Update (shown publicly)"><textarea className="input mt-1 min-h-[6rem]" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
    </Modal>
  );
}

export default function StatusAdmin() {
  const canEdit = usePlatformMe().can('comms', 'full');
  const confirm = useConfirm();
  const q = useQuery<StatusPageData>('/platform/status');
  const [newIncident, setNewIncident] = useState(false);
  const [updating, setUpdating] = useState<StatusIncident | null>(null);
  const [compName, setCompName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); q.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'That didn’t work'); } };
  if (q.loading && !q.data) return <StateBlock><Spinner /></StateBlock>;
  if (q.error || !q.data) return <StateBlock>{q.error ?? 'Could not load the status page'}</StateBlock>;
  const s = q.data;
  return (
    <>
      <PageHeader title="Status page" subtitle={`What customers see at /status — now: ${STATE_LABEL[s.status]}`}
        action={<>
          <Link to="/status" className="btn-ghost" target="_blank">Open /status</Link>
          {canEdit && <button className="btn-primary" onClick={() => setNewIncident(true)}>New incident</button>}
        </>} />
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Components">
          {!s.components.length && <p className="text-small text-fg-muted">No components yet — add Tracking, Dashboard, API, Postbacks…</p>}
          <ul className="divide-y divide-border">
            {s.components.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-small">
                <span className="flex-1 font-medium text-fg">{c.name}</span>
                {canEdit ? (
                  <select className="input !w-auto !py-1 text-tiny" value={c.status} onChange={(e) => void act(() => api.patch(`/platform/status/components/${c.id}`, { status: e.target.value }))}>
                    {Object.entries(STATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : <Chip className={STATE_TONE[c.status] ?? ''}>{STATE_LABEL[c.status]}</Chip>}
                {canEdit && <button className="text-tiny text-danger-text hover:underline" onClick={() => void confirm({ title: 'Remove component?', message: `Remove ${c.name} from the status page?`, confirmLabel: 'Remove', destructive: true, onConfirm: () => act(() => api.del(`/platform/status/components/${c.id}`)) })}>Remove</button>}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (compName.trim()) void act(async () => { await api.post('/platform/status/components', { name: compName.trim(), position: s.components.length }); setCompName(''); }); }}>
              <input className="input" placeholder="Component name" value={compName} onChange={(e) => setCompName(e.target.value)} maxLength={120} />
              <button className="btn-ghost" type="submit">Add</button>
            </form>
          )}
        </Panel>
        <Panel title={`Open incidents (${s.incidents.length})`}>
          {!s.incidents.length && <p className="text-small text-fg-muted">Nothing open.</p>}
          {s.incidents.map((i) => (
            <div key={i.id} className="mb-3 rounded-[var(--radius)] border border-border p-3">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-fg">{i.title}</span><Chip className="bg-page ring-1 ring-inset ring-border">{INCIDENT_STATE_LABEL[i.status]}</Chip><span className="text-tiny text-fg-muted">impact {i.impact}</span>
                {canEdit && <button className="ml-auto text-tiny font-medium text-accent-text hover:underline" onClick={() => setUpdating(i)}>Post update</button>}</div>
              <ul className="mt-2 space-y-1 text-tiny text-fg-secondary">{(i.updates ?? []).map((u) => <li key={u.id}><span className="font-medium">{INCIDENT_STATE_LABEL[u.status]}</span> · {new Date(u.created_at).toLocaleString()} — {u.body}</li>)}</ul>
            </div>
          ))}
        </Panel>
      </div>
      {s.history.length > 0 && (
        <div className="mt-4"><Panel title="Resolved in the last 14 days">
          <ul className="space-y-1 text-small">{s.history.map((i) => <li key={i.id}>{i.title} <span className="text-tiny text-fg-muted">resolved {i.resolved_at ? new Date(i.resolved_at).toLocaleString() : ''}</span></li>)}</ul>
        </Panel></div>
      )}
      {newIncident && <IncidentForm components={s.components} onClose={() => setNewIncident(false)} onSaved={() => { setNewIncident(false); q.refetch(); }} />}
      {updating && <UpdateForm incident={updating} onClose={() => setUpdating(null)} onSaved={() => { setUpdating(null); q.refetch(); }} />}
    </>
  );
}

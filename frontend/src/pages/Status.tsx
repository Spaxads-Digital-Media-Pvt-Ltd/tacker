/**
 * The public status page (/status, no sign-in) — each component's state, open incidents with their
 * updates, scheduled maintenance and the last 14 days' resolved incidents (GET /api/public/status).
 */
import { useEffect, useState } from 'react';
import { Brandmark } from '../shared-components/primitives/Brandmark';
import { INCIDENT_STATE_LABEL, STATE_LABEL, STATE_TONE, type StatusPageData } from '../lib/platformComms';

const DOT: Record<string, string> = { operational: 'bg-success', degraded: 'bg-warning', partial_outage: 'bg-warning', major_outage: 'bg-danger', maintenance: 'bg-info' };

export default function Status() {
  const [data, setData] = useState<StatusPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/public/status').then((r) => r.json()).then((j) => { if (live) { setData(j.data); setError(null); } }).catch(() => { if (live) setError('The status page can’t be reached right now.'); });
    void load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return (
    <div className="min-h-full bg-page p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between"><Brandmark /><span className="text-small text-fg-secondary">System status</span></div>
        {error && <p className="card text-small text-danger-text">{error}</p>}
        {!data ? (!error && <p className="text-small text-fg-secondary">Loading…</p>) : (
          <>
            <div className={`card mb-4 flex items-center gap-3 ${STATE_TONE[data.status] ?? ''}`}>
              <span className={`h-3 w-3 rounded-full ${DOT[data.status] ?? 'bg-fg-muted'}`} />
              <p className="text-h3 font-semibold">{data.status === 'operational' ? 'All systems operational' : STATE_LABEL[data.status]}</p>
            </div>
            {data.incidents.map((i) => (
              <div key={i.id} className="card mb-3">
                <p className="text-small font-semibold text-fg">{i.title}</p>
                <p className="text-tiny text-fg-secondary">{INCIDENT_STATE_LABEL[i.status]}{i.status === 'scheduled' ? ` · starts ${new Date(i.starts_at).toLocaleString()}` : ''}</p>
                <ul className="mt-2 space-y-1.5">{(i.updates ?? []).map((u) => <li key={u.id} className="text-small"><span className="font-medium">{INCIDENT_STATE_LABEL[u.status]}</span> — {u.body} <span className="text-tiny text-fg-muted">{new Date(u.created_at).toLocaleString()}</span></li>)}</ul>
              </div>
            ))}
            <div className="card divide-y divide-border">
              {data.components.length === 0 && <p className="text-small text-fg-secondary">No components listed.</p>}
              {data.components.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5">
                  <div><p className="text-small font-medium text-fg">{c.name}</p>{c.description && <p className="text-tiny text-fg-secondary">{c.description}</p>}</div>
                  <span className="flex items-center gap-2 text-tiny text-fg-secondary"><span className={`h-2 w-2 rounded-full ${DOT[c.status] ?? 'bg-fg-muted'}`} />{STATE_LABEL[c.status]}</span>
                </div>
              ))}
            </div>
            {data.history.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-2 text-small font-semibold text-fg">Past incidents (14 days)</h2>
                {data.history.map((i) => <p key={i.id} className="text-small text-fg-secondary">{i.title} — resolved {i.resolved_at ? new Date(i.resolved_at).toLocaleString() : ''}</p>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

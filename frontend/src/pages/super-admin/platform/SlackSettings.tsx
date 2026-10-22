/**
 * Super Admin › Settings › Slack — post the platform team's events to a Slack channel: the channel's
 * incoming webhook (kept secret — only its last characters are shown), on / off, which events, and a test
 * message (GET / PUT /platform/settings/slack, POST …/test).
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';

interface Slack { enabled: boolean; hasWebhook: boolean; webhookHint: string | null; events: Record<string, boolean>; eventList: { key: string; label: string }[] }

export function SlackSettings() {
  const { can } = usePlatformMe();
  const edit = can('settings', 'full');
  const s = useQuery<Slack>('/platform/settings/slack');
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [webhook, setWebhook] = useState('');
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState(false);
  useEffect(() => { if (s.data) { setEnabled(s.data.enabled); setEvents(s.data.events); } }, [s.data]);
  const save = useMutation((b: Record<string, unknown>) => api.put<Slack>('/platform/settings/slack', b));
  const test = useMutation(() => api.post('/platform/settings/slack/test', {}));
  if (s.loading && !s.data) return <StateBlock><Spinner /></StateBlock>;
  if (s.error || !s.data) return <StateBlock>{s.error ?? 'Could not load the Slack settings'}</StateBlock>;
  const submit = async (extra: Record<string, unknown> = {}) => {
    setSaved(false); setTested(false);
    if (await save.run({ enabled, events, ...(webhook.trim() ? { webhookUrl: webhook.trim() } : {}), ...extra })) { setWebhook(''); setSaved(true); s.refetch(); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-4">
        <div>
          <h3 className="text-h3 font-medium text-fg">Slack</h3>
          <p className="text-small text-fg-secondary">Post what the team should know — new networks, demo requests, tickets, quotes, payments — to a Slack channel. In Slack: Apps › Incoming Webhooks › Add to a channel, then paste its URL here.</p>
        </div>
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        {saved && !save.error && <p className="text-small text-success-text">Saved.</p>}
        <Field label="Webhook URL">
          <input className="input font-mono" disabled={!edit} value={webhook} onChange={(e) => setWebhook(e.target.value)}
            placeholder={s.data.hasWebhook ? `Saved (${s.data.webhookHint}) — paste a new one to replace it` : 'https://hooks.slack.com/services/…'} />
        </Field>
        <label className="flex items-center gap-2 text-small text-fg">
          <input type="checkbox" className="h-4 w-4" disabled={!edit} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Post to Slack
        </label>
        <div>
          <p className="label">Events</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {s.data.eventList.map((ev) => (
              <label key={ev.key} className="flex items-center gap-2 text-small text-fg">
                <input type="checkbox" className="h-4 w-4" disabled={!edit} checked={events[ev.key] !== false} onChange={(e) => setEvents((x) => ({ ...x, [ev.key]: e.target.checked }))} /> {ev.label}
              </label>
            ))}
          </div>
        </div>
        {edit && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {s.data.hasWebhook && <button className="btn-ghost mr-auto text-danger-text" disabled={save.busy} onClick={() => void submit({ enabled: false, webhookUrl: null })}>Remove the webhook</button>}
            {test.error && <span className="text-small text-danger-text">{test.error}</span>}
            {tested && !test.error && <span className="text-small text-success-text">Sent — check the channel.</span>}
            {s.data.hasWebhook && <button className="btn-ghost" disabled={test.busy} onClick={async () => { setTested(false); if (await test.run(undefined)) setTested(true); }}>{test.busy ? 'Sending…' : 'Send a test message'}</button>}
            <button className="btn-primary" disabled={save.busy} onClick={() => void submit()}>{save.busy ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

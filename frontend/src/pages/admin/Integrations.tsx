/**
 * Integrations hub (Everflow/Spaxads style): Offer, MMP (AppsFlyer/Branch/Adjust), Pin API, and
 * Facebook CAPI. Connection configs are stored per-network in settings.integrations (via
 * /api/settings). This screen manages the keys/URLs and shows the catalog; live sync jobs are a
 * later backend addition (shown honestly as "not connected" until configured).
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Field, StateBlock, Spinner } from '../../components/ui';

const TABS = ['MMP', 'Facebook CAPI', 'Pin API', 'Offer'] as const;

export default function Integrations() {
  const [tab, setTab] = useState<string>('MMP');
  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect attribution platforms, pixels and offer feeds." />
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      {tab === 'MMP' && <MmpCatalog />}
      {tab === 'Facebook CAPI' && <SettingsForm title="Facebook Conversions API" fields={[
        { key: 'fbPixelId', label: 'Dataset / Pixel ID' },
        { key: 'fbAccessToken', label: 'Access Token', secret: true },
      ]} />}
      {tab === 'Pin API' && <SettingsForm title="Pin (Network) API Key" fields={[{ key: 'pinApiKey', label: 'API Key', secret: true }]} />}
      {tab === 'Offer' && <SettingsForm title="Offer Feed" fields={[
        { key: 'offerFeedUrl', label: 'Feed URL' },
        { key: 'offerFeedKey', label: 'Feed API Key', secret: true },
      ]} />}
    </>
  );
}

const MMPS = [
  { name: 'AppsFlyer', desc: 'Mobile attribution & marketing analytics with fraud protection and deep linking.', tone: 'from-blue-500 to-indigo-600' },
  { name: 'Branch', desc: 'Deep linking and attribution connecting users across devices and channels.', tone: 'from-sky-500 to-blue-600' },
  { name: 'Adjust', desc: 'Mobile measurement and fraud prevention to optimize campaigns.', tone: 'from-emerald-500 to-green-600' },
  { name: 'Kochava', desc: 'Omni-channel measurement and attribution for apps.', tone: 'from-purple-500 to-fuchsia-600' },
  { name: 'Singular', desc: 'Marketing analytics with cost aggregation and attribution.', tone: 'from-amber-500 to-orange-600' },
  { name: 'Tenjin', desc: 'Mobile marketing infrastructure and attribution.', tone: 'from-rose-500 to-pink-600' },
];

function MmpCatalog() {
  return (
    <div>
      <div className="card mb-6">
        <h2 className="text-h3 font-semibold text-fg">Mobile App Tracking Integrations</h2>
        <p className="mt-1 text-sm text-fg-secondary">Connect your mobile attribution platform to track installs and in-app events. Configure a postback URL per provider to receive real-time attribution.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MMPS.map((m) => (
          <div key={m.name} className="card flex flex-col">
            <div className={`mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${m.tone} text-white`}>
              <span className="text-lg font-bold">{m.name[0]}</span>
            </div>
            <p className="font-semibold text-fg">{m.name}</p>
            <p className="mt-1 flex-1 text-sm text-fg-secondary">{m.desc}</p>
            <button className="btn-ghost mt-4 justify-center "
              onClick={() => alert(`${m.name}: paste your postback template into Integrations settings, then set your ${m.name} dashboard to call it on install/event.`)}>
              ⚙ Setup &amp; Instructions
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SF { key: string; label: string; secret?: boolean }
function SettingsForm({ title, fields }: { title: string; fields: SF[] }) {
  const { data, loading, refetch } = useQuery<{ integrations: Record<string, unknown> }>('/api/settings');
  const [form, setForm] = useState<Record<string, string>>({});
  const { run, busy, error } = useMutation((values: Record<string, unknown>) => api.put('/api/settings/integrations', { values }));
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const cur = data?.integrations ?? {};
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, unknown> = {};
    for (const f of fields) if (form[f.key] !== undefined && form[f.key] !== '') values[f.key] = form[f.key];
    if (await run(values)) { setForm({}); refetch(); }
  };
  return (
    <form onSubmit={submit} className="card max-w-xl space-y-3">
      <h2 className="text-h3 font-semibold text-fg">{title}</h2>
      {error && <p className="text-sm text-danger-text">{error}</p>}
      {fields.map((f) => (
        <Field key={f.key} label={`${f.label}${cur[f.key] ? ' (set — leave blank to keep)' : ''}`}>
          <input className="input" type={f.secret ? 'password' : 'text'} value={form[f.key] ?? ''}
            placeholder={cur[f.key] ? '••••••••' : ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
        </Field>
      ))}
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save integration'}</button>
    </form>
  );
}

/**
 * Network settings — General, Email (SMTP), Integrations, and a pointer to Domains. Reads/writes
 * /api/settings. The SMTP password is write-only (server never returns it; we show whether one is
 * set and only send a new one when typed).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Field, Spinner, StateBlock } from '../../components/ui';
import { useAuth } from '../../auth/AuthContext';
import { loadSession, saveSession } from '../../auth/session';
import { THEMES, DEFAULT_THEME, applyTheme, type ThemeId } from '../../lib/themes';

interface SettingsData {
  general: { name?: string; defaultCurrency?: string; status?: string; timezone?: string; supportEmail?: string };
  smtp: { host?: string; port?: number; username?: string; fromEmail?: string; fromName?: string; secure?: boolean; passwordSet?: boolean };
  integrations: Record<string, unknown>;
}

const TABS = ['General', 'Appearance', 'Email (SMTP)', 'Integrations', 'Domains'] as const;

export default function Settings() {
  const { data, loading, error, refetch } = useQuery<SettingsData>('/api/settings');
  const [tab, setTab] = useState<string>('General');

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !data) return <StateBlock>{error ?? 'Failed to load settings'}</StateBlock>;

  return (
    <>
      <PageHeader title="Settings" subtitle="Network configuration, email delivery, integrations and domains." />
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      {tab === 'General' && <GeneralForm data={data.general} onSaved={refetch} />}
      {tab === 'Appearance' && <ThemePicker />}
      {tab === 'Email (SMTP)' && <SmtpForm data={data.smtp} onSaved={refetch} />}
      {tab === 'Integrations' && <IntegrationsForm data={data.integrations} onSaved={refetch} />}
      {tab === 'Domains' && <DomainsPanel />}
    </>
  );
}

/** Theme picker (Section 6) — six accent swatches; persists per-user server-side, applies instantly. */
function ThemePicker() {
  const { session } = useAuth();
  const [selected, setSelected] = useState<ThemeId>((session?.theme as ThemeId) ?? DEFAULT_THEME);
  const { run, busy } = useMutation((theme: string) => api.patch('/api/me/theme', { theme }));

  const pick = async (id: ThemeId) => {
    setSelected(id);
    applyTheme(id);                                   // instant recolor
    const s = loadSession();
    if (s) saveSession({ ...s, theme: id });          // keep session copy in sync
    await run(id);                                     // persist server-side (Option A)
  };

  return (
    <div className="max-w-2xl">
      <h3 className="text-h3 font-medium text-fg">Accent theme</h3>
      <p className="mt-1 text-small text-fg-secondary">
        Choose your accent color. Status colors (success, warning, danger) stay the same in every theme.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => {
          const on = selected === t.id;
          return (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              disabled={busy}
              aria-pressed={on}
              className={`overflow-hidden rounded-card border text-left transition-colors ${on ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-accent'}`}
            >
              {/* Mini app preview so each theme reads as a real recolor across elements */}
              <div className="p-2.5" style={{ backgroundColor: 'rgb(var(--bg-page))' }}>
                <div className="rounded-md border border-border bg-surface p-2">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `rgb(${t.accent})` }} />
                    <span className="h-1.5 w-10 rounded-full bg-border" />
                    <span className="ml-auto h-1.5 w-4 rounded-full bg-border" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded px-1.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: `rgb(${t.subtle})`, color: `rgb(${t.text})` }}>Active</span>
                    <span className="ml-auto rounded px-2 py-1 text-[10px] font-semibold text-white" style={{ backgroundColor: `rgb(${t.accent})` }}>Button</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border bg-surface px-3 py-2">
                <span className="flex items-center gap-1.5 text-small font-medium text-fg">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `rgb(${t.accent})` }} />
                  {t.name}{t.isDefault && <span className="text-tiny text-fg-muted">· Default</span>}
                </span>
                {on && <Check size={16} className="text-accent" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SaveRow({ busy, error }: { busy: boolean; error: string | null }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      {error && <span className="text-sm text-danger-text">{error}</span>}
    </div>
  );
}

function GeneralForm({ data, onSaved }: { data: SettingsData['general']; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', defaultCurrency: '', timezone: '', supportEmail: '' });
  useEffect(() => setForm({ name: data.name ?? '', defaultCurrency: data.defaultCurrency ?? '', timezone: data.timezone ?? '', supportEmail: data.supportEmail ?? '' }), [data]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.put('/api/settings/general', body));
  const submit = async (e: FormEvent) => { e.preventDefault(); const r = await run(form); if (r) onSaved(); };
  return (
    <form onSubmit={submit} className="max-w-lg space-y-3">
      <Field label="Network name"><input className="input" value={form.name} onChange={set('name')} /></Field>
      <Field label="Default currency"><input className="input max-w-[120px]" maxLength={3} value={form.defaultCurrency} onChange={set('defaultCurrency')} /></Field>
      <Field label="Timezone"><input className="input" placeholder="UTC" value={form.timezone} onChange={set('timezone')} /></Field>
      <Field label="Support email"><input className="input" type="email" value={form.supportEmail} onChange={set('supportEmail')} /></Field>
      <SaveRow busy={busy} error={error} />
    </form>
  );
}

function SmtpForm({ data, onSaved }: { data: SettingsData['smtp']; onSaved: () => void }) {
  const [form, setForm] = useState({ host: '', port: '587', username: '', password: '', fromEmail: '', fromName: '', secure: false });
  useEffect(() => setForm({
    host: data.host ?? '', port: String(data.port ?? 587), username: data.username ?? '',
    password: '', fromEmail: data.fromEmail ?? '', fromName: data.fromName ?? '', secure: Boolean(data.secure),
  }), [data]);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.put('/api/settings/smtp', body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { host: form.host, port: Number(form.port), username: form.username, fromEmail: form.fromEmail, fromName: form.fromName, secure: form.secure };
    if (form.password) body['password'] = form.password;
    const r = await run(body); if (r) onSaved();
  };
  return (
    <form onSubmit={submit} className="max-w-lg space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="SMTP host"><input className="input" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.mailgun.org" /></Field>
        <Field label="Port"><input className="input" type="number" value={form.port} onChange={(e) => set('port', e.target.value)} /></Field>
      </div>
      <Field label="Username"><input className="input" value={form.username} onChange={(e) => set('username', e.target.value)} /></Field>
      <Field label={`Password ${data.passwordSet ? '(set — leave blank to keep)' : ''}`}><input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={data.passwordSet ? '••••••••' : ''} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From email"><input className="input" type="email" value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} /></Field>
        <Field label="From name"><input className="input" value={form.fromName} onChange={(e) => set('fromName', e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="chk" checked={form.secure} onChange={(e) => set('secure', e.target.checked)} /> Use TLS/SSL</label>
      <SaveRow busy={busy} error={error} />
    </form>
  );
}

function IntegrationsForm({ data, onSaved }: { data: Record<string, unknown>; onSaved: () => void }) {
  const [form, setForm] = useState({ webhookUrl: '', slackWebhook: '', s2sPostbackKey: '' });
  useEffect(() => setForm({
    webhookUrl: String(data['webhookUrl'] ?? ''), slackWebhook: String(data['slackWebhook'] ?? ''), s2sPostbackKey: String(data['s2sPostbackKey'] ?? ''),
  }), [data]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.put('/api/settings/integrations', body));
  const submit = async (e: FormEvent) => { e.preventDefault(); const r = await run({ values: form }); if (r) onSaved(); };
  return (
    <form onSubmit={submit} className="max-w-lg space-y-3">
      <p className="text-sm text-fg-secondary ">Endpoints and keys for outbound integrations. Stored per network.</p>
      <Field label="Generic webhook URL"><input className="input" value={form.webhookUrl} onChange={set('webhookUrl')} placeholder="https://…" /></Field>
      <Field label="Slack incoming webhook"><input className="input" value={form.slackWebhook} onChange={set('slackWebhook')} placeholder="https://hooks.slack.com/…" /></Field>
      <Field label="S2S postback signing key"><input className="input" value={form.s2sPostbackKey} onChange={set('s2sPostbackKey')} /></Field>
      <SaveRow busy={busy} error={error} />
    </form>
  );
}

function DomainsPanel() {
  return (
    <div className="card max-w-lg">
      <p className="text-sm text-fg-secondary ">Tracking domains (subdomains and custom vanity domains, SSL and verification) are managed on their own screen.</p>
      <Link to="/app/domains" className="btn-primary mt-4 inline-flex">Manage domains →</Link>
    </div>
  );
}

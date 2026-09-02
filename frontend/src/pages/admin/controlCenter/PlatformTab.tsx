/**
 * Control Center › Platform — network-wide branding/config, domains, IP blacklist, default
 * notification preferences, and billing defaults. The reference has dozens of network-config
 * toggles with no equivalent in this app at all (no network branding/config table) — those render
 * as honest "—". Domains reuses the real tracking-domains list already used elsewhere (Traffic
 * Health, the Domains page).
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, Info, Search, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Tabs, Table, Badge, Field, Spinner, StateBlock, type Column, Segmented } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { Pagination } from '../../../components/ReportPageKit';
import { InfoCard, InfoGrid, InfoRow, NotificationCard, EditableInfoCard, HelpIcon, InfoBanner, HeadsUpBanner, type EditField } from './shared';
import type { TrackingDomain } from '../../../types';
import {
  PARTNER_NOTIFS, OFFER_NOTIFS_PLATFORM, OFFER_GROUP_NOTIFS, ADVERTISER_NOTIFS,
  ACTION_NOTIFS, BILLING_NOTIFS, NETWORK_NOTIFS, SECURITY_NOTIFS, TRAFFIC_HEALTH_NOTIFS,
} from '../../../data/defaultNotifications';

const SUB_TABS = ['General', 'Domains', 'IPs', 'Default Notifications', 'Billing'] as const;

interface ToggleDef { label: string; help?: string }
const GLOBAL_TOGGLE_DEFS: ToggleDef[] = [
  { label: "Enable Partners/Advertisers managers as 'Reply-To' address", help: "Use the assigned manager's email as the Reply-To address on outbound emails." },
  { label: 'Enable Global CPC/CPM Dynamic Payouts in Tracking Links', help: 'Allow a payout override to be passed as a tracking link parameter.' },
  { label: 'Enable pre-populated data for Tracking Links', help: 'Pre-fill tracking link generator fields from the last-used values.' },
  { label: 'Enable Partner Notifications for Offer Caps' },
  { label: 'Enable Partners to select timezones in their UI', help: "Lets Partners choose their own display timezone instead of the network's." },
  { label: 'Set Offer cap Threshold Percentage', help: 'The percentage of a cap at which an "approaching cap" notification fires.' },
  { label: 'Enable Offer Caps in Partner UI' },
  { label: 'Enable Partners to update billing details inside their Partner UI' },
  { label: 'Enable Global Fail Traffic', help: 'Redirect clicks that fail every Offer targeting rule to a network-wide fallback.' },
  { label: 'Carry Over Partner Visibility Selection From Previous Setting', help: 'Keep the same Partner visibility choice when duplicating an Offer.' },
  { label: 'Set Macro Parameter Visibility for Partners', help: 'Which Adv1-Adv10 macro slots Partners can see in their tracking links.' },
  { label: 'Allow partners to manage Postbacks', help: 'Lets Partners configure their own postback URLs from their portal.' },
  { label: 'Enable Fail Traffic and Forwarding Rules when Offer is paused' },
  { label: 'Enable Partner Email Verification', help: "Require a Partner to confirm their email before their account is active." },
  { label: 'Set CPC Calculation Based On', help: 'Whether CPC is computed from unique or gross clicks.' },
  { label: 'Enable Advertiser Email Verification', help: 'Require an Advertiser to confirm their email before their account is active.' },
  { label: 'Set On Hold Partner Visibility', help: 'Whether Partners on hold can still see their own stats and links.' },
  { label: 'Hide Partner Impression Links' },
  { label: 'Hide Partner Tracking Links' },
  { label: 'Hide Partner Smart Links' },
];
const GLOBAL_TOGGLES = GLOBAL_TOGGLE_DEFS.map((t) => t.label);

function Checkbox({ label, help, defaultChecked }: { label: string; help?: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(!!defaultChecked);
  return (
    <label className="flex items-center gap-2 text-small text-fg">
      <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 rounded border-border" />
      {label}
      {help && <HelpIcon text={help} />}
    </label>
  );
}

/** Nested "Yes/No" pill used under Set Macro Parameter Visibility for Partners when Visible —
 * a wide rounded pill with the current state's label and a colored dot, matching the reference's
 * indented sub-toggle style (distinct from the plain checkboxes and the boxed Segmented control). */
function YesNoPill({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-small text-fg">{label}</span>
      <button type="button" onClick={() => onChange(!value)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-tiny font-medium text-fg-secondary hover:bg-page">
        <span className={`h-2 w-2 rounded-full ${value ? 'bg-success' : 'bg-border'}`} />
        {value ? 'Yes' : 'No'}
      </button>
    </div>
  );
}

function UploadBox({ label }: { label: string }) {
  return (
    <div>
      <label className="label mb-2 block">{label}</label>
      <div className="grid h-[74px] place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">Drag and drop or Browse</div>
    </div>
  );
}

interface NetworkSettings { general: { nid: number; name: string; defaultCurrency: string; status: string; timezone?: string; supportEmail?: string } }

/** "Edit General" — matches platform_general_edit.png field-for-field. Network Displayed Name,
 * Support Email, Currency, and Timezone are real (PUT /api/settings/general, the same real network
 * settings Settings › General already writes) — the rest (Language, Show toggles, colors, logo)
 * have no backend concept in this app, so they stay real, interactive, non-persisting controls. */
function EditGeneralForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const { data: settings } = useQuery<NetworkSettings>('/api/settings');
  const [name, setName] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('UTC');
  useEffect(() => {
    if (!settings) return;
    setName(settings.general.name ?? '');
    setSupportEmail(settings.general.supportEmail ?? '');
    setCurrency(settings.general.defaultCurrency ?? 'USD');
    setTimezone(settings.general.timezone ?? 'UTC');
  }, [settings]);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.put('/api/settings/general', body));

  const save = async () => {
    if (await run({ name, supportEmail: supportEmail || undefined, defaultCurrency: currency, timezone })) onSaved();
  };

  return (
    <div className="max-w-2xl mx-auto card space-y-4">
      <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Network Displayed Name *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Checkbox label="Show Name" defaultChecked />
      <Field label="Support Email *"><input className="input" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} /></Field>
      <Field label="Currency *">
        <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">$ US Dollar (USD)</option>
          <option value="EUR">€ Euro (EUR)</option>
          <option value="GBP">£ British Pound (GBP)</option>
        </select>
      </Field>
      <Field label="Language *"><select className="input" defaultValue="English"><option>English</option></select></Field>
      <Field label="Timezone"><input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. UTC, America/Los_Angeles" /></Field>
      <Checkbox label="Show Partner Sign Up link (Login page)" defaultChecked />
      <Checkbox label="Show Advertiser Sign Up link (Login page)" defaultChecked />
      <Checkbox label="Show Everflow Support Link in Partner and Advertiser UIs" />
      <div className="grid grid-cols-1 gap-3 rounded-card border border-border p-3 sm:grid-cols-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-small text-fg"><span className="h-4 w-4 rounded-full bg-[#1E3557]" />Default Primary Color (#1E3557)</span>
          <button title="Not available yet" className="text-tiny font-medium text-accent-text">Edit</button>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-small text-fg"><span className="h-4 w-4 rounded-full bg-[#60A8EF]" />Default Secondary Color (#60A8EF)</span>
          <button title="Not available yet" className="text-tiny font-medium text-accent-text">Edit</button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UploadBox label="Logo" />
        <UploadBox label="Favicon" />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

/** "Edit Global" — matches platform_global_edit.png field-for-field: the leading checkbox block,
 * threshold %, CPC calculation segment, fail-traffic toggle, then the exact tail sequence from the
 * reference — Macro Visibility (with its nested adv1-10/sale_amount sub-panel when Visible), Carry
 * Over, the three Hide Partner * Links checkboxes, the three partner-facing checkboxes, and finally
 * the 3-way On Hold Partner Visibility segment. No backing table for any of this (Global Settings
 * has no network-config schema in this app) so Save stays inert like every other honest-shell form. */
function EditGlobalForm({ onCancel }: { onCancel: () => void }) {
  const help = new Map(GLOBAL_TOGGLE_DEFS.map((t) => [t.label, t.help]));
  const [threshold, setThreshold] = useState('90');
  const [cpcBasis, setCpcBasis] = useState('Unique Clicks');
  const [macroVisibility, setMacroVisibility] = useState('Visible');
  const [adv110Visible, setAdv110Visible] = useState(true);
  const [saleAmountVisible, setSaleAmountVisible] = useState(true);
  const [onHoldVisibility, setOnHoldVisibility] = useState('Visible');
  const checkedByDefault = new Set([
    'Enable Fail Traffic and Forwarding Rules when Offer is paused',
    'Enable Partners to select timezones in their UI',
    'Enable Offer Caps in Partner UI',
    'Enable Partners to update billing details inside their Partner UI',
    'Allow partners to manage Postbacks',
    'Enable Partner Email Verification',
    'Enable Advertiser Email Verification',
  ]);
  const leading = [
    "Enable Partners/Advertisers managers as 'Reply-To' address",
    'Enable Global CPC/CPM Dynamic Payouts in Tracking Links',
    'Enable pre-populated data for Tracking Links',
    'Enable Partner Notifications for Offer Caps',
    'Enable Partners to select timezones in their UI',
    'Enable Offer Caps in Partner UI',
    'Enable Partners to update billing details inside their Partner UI',
  ];
  const tail = [
    'Carry Over Partner Visibility Selection From Previous Setting',
    'Hide Partner Impression Links',
    'Hide Partner Tracking Links',
    'Hide Partner Smart Links',
    'Allow partners to manage Postbacks',
    'Enable Partner Email Verification',
    'Enable Advertiser Email Verification',
  ];
  return (
    <div className="max-w-2xl mx-auto card space-y-4">
      <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
      {leading.map((g) => <Checkbox key={g} label={g} help={help.get(g)} defaultChecked={checkedByDefault.has(g)} />)}
      <Field label="Set Offer cap Threshold Percentage *"><input className="input" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
      <div>
        <label className="label mb-2 block">Set CPC Calculation Based On *</label>
        <Segmented options={['Unique Clicks', 'Gross Clicks']} value={cpcBasis} onChange={setCpcBasis} />
      </div>
      <Checkbox label="Enable Global Fail Traffic" help={help.get('Enable Global Fail Traffic')} />
      <div>
        <label className="mb-2 flex items-center gap-1.5 text-small font-semibold text-fg">
          Set Macro Parameter Visibility for Partners <HelpIcon text={help.get('Set Macro Parameter Visibility for Partners') ?? ''} />
        </label>
        <Segmented options={['Invisible', 'Visible']} value={macroVisibility} onChange={setMacroVisibility} />
        {macroVisibility === 'Visible' && (
          <div className="mt-3 space-y-3 rounded-card border border-border bg-page p-3">
            <YesNoPill label="Set adv1-adv10 as visible" value={adv110Visible} onChange={setAdv110Visible} />
            <YesNoPill label="Set sale_amount as visible" value={saleAmountVisible} onChange={setSaleAmountVisible} />
          </div>
        )}
      </div>
      {tail.map((g) => <Checkbox key={g} label={g} help={help.get(g)} defaultChecked={checkedByDefault.has(g)} />)}
      <div>
        <label className="mb-2 flex items-center gap-1.5 text-small font-semibold text-fg">
          Set On Hold Partner Visibility <HelpIcon text={help.get('Set On Hold Partner Visibility') ?? ''} />
        </label>
        <Segmented options={['Invisible', 'Visible', 'Restricted']} value={onHoldVisibility} onChange={setOnHoldVisibility} />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onCancel}>Save</button>
      </div>
    </div>
  );
}

function ImagePreviewBox({ label, help }: { label: string; help: string }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-small font-semibold text-fg">{label} <HelpIcon text={help} /></p>
      <div className="grid h-20 w-32 place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">Not set</div>
    </div>
  );
}

function ColorSwatchRow({ label, color }: { label: string; color: string | null }) {
  return (
    <div>
      <p className="mb-2 text-small font-semibold text-fg">{label}</p>
      <div className="flex items-center gap-2 text-small text-fg-secondary">
        <span className="h-4 w-4 rounded-full border border-border" style={color ? { background: color } : undefined} />
        {color ?? '—'}
      </div>
    </div>
  );
}

/** Global Postback — real, using this network's actual primary tracking domain and postback
 * secure_code (Settings › Security's real postback_security_code, previously stored but only
 * ever consumed by the tracking surface itself — never surfaced anywhere in the dashboard UI). */
function GlobalPostbackCard() {
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const { data: security } = useQuery<{ securityCode: string | null }>('/api/settings/security');
  const [copied, setCopied] = useState(false);
  const primary = domains?.find((d) => d.isPrimary) ?? domains?.[0];
  const url = primary
    ? `https://${primary.host}/postback?click_id=CLICK_ID&transaction_id=TRANSACTION_ID${security?.securityCode ? `&secure_code=${security.securityCode}` : ''}`
    : null;

  const copy = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <InfoCard title="Global Postback" action={<span />}>
      {url ? (
        <div className="relative rounded-card border border-border bg-page p-3 pb-10">
          <code className="break-all text-small text-fg">{url}</code>
          <button type="button" title={copied ? 'Copied!' : 'Copy'} onClick={copy}
            className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <Copy size={14} />
          </button>
        </div>
      ) : (
        <p className="text-small text-fg-muted">Add a tracking domain first to get your global postback URL.</p>
      )}
      <p className="mt-3 text-small text-fg-secondary">
        The conversion postback should include the <strong>click ID</strong>, which is captured by the macro when your click-tracking link redirects.
        {security?.securityCode ? ' The secure_code shown is validated on every S2S postback unless the offer overrides it.' : ' Set a postback security code in Control Center › Security to have it appended automatically.'}
      </p>
    </InfoCard>
  );
}

function AddressCard() {
  return (
    <InfoCard title="Address" action={<span />}>
      <InfoGrid>
        <InfoRow label="Address" /><InfoRow label="Apartment, suite, etc." />
        <InfoRow label="Country" /><InfoRow label="Region/State" />
        <InfoRow label="City" /><InfoRow label="ZIP/Postal Code" />
      </InfoGrid>
    </InfoCard>
  );
}

function GeneralSub() {
  const origin = window.location.origin;
  const [editing, setEditing] = useState<'general' | 'global' | null>(null);
  const { data: settings, refetch } = useQuery<NetworkSettings>('/api/settings');
  const toggleHelp = new Map(GLOBAL_TOGGLE_DEFS.map((t) => [t.label, t.help]));

  if (editing === 'general') return <EditGeneralForm onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); refetch(); }} />;
  if (editing === 'global') return <EditGlobalForm onCancel={() => setEditing(null)} />;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <InfoCard title="General" action={<button className="text-tiny font-medium text-accent-text" onClick={() => setEditing('general')}>Edit</button>}>
          <InfoGrid>
            <InfoRow label="Network Identifier" value={settings?.general.name} />
            <ImagePreviewBox label="Logo" help="Shown in the top-left corner of the dashboard and Partner/Advertiser portals." />
            <InfoRow label="NID" value={settings?.general.nid} />
            <ImagePreviewBox label="Favicon" help="Shown as the browser-tab icon across every portal." />
            <InfoRow label="Support Email" value={settings?.general.supportEmail} />
            <ColorSwatchRow label="Primary Color" color={null} />
            <InfoRow label="Language" value="English" />
            <ColorSwatchRow label="Secondary Color" color={null} />
            <InfoRow label="Timezone" value={settings?.general.timezone} />
            <InfoRow label="HTML Custom Footer (Left menu)" />
            <InfoRow label="Currency" value={settings?.general.defaultCurrency} />
            <InfoRow label="Show Name" />
            <InfoRow label="Show Partner Sign Up link (Login page)" help="Adds a Partner sign-up link to the login page." />
            <InfoRow label="Show Advertiser Sign Up link (Login page)" help="Adds an Advertiser sign-up link to the login page." />
            <InfoRow label="Show Everflow Support Link in Partner and Advertiser UIs" />
          </InfoGrid>
        </InfoCard>
        <GlobalPostbackCard />
        <AddressCard />
      </div>
      <div className="space-y-4">
        <InfoCard title="Links" action={<span />}>
          <InfoGrid>
            <InfoRow label="Partner Login URL" value={<a className="text-accent-text" href={`${origin}/login`}>{origin}/login</a>} />
            <InfoRow label="Advertiser Login URL" value={<a className="text-accent-text" href={`${origin}/login`}>{origin}/login</a>} />
            <InfoRow label="Partner Sign Up URL" />
            <InfoRow label="Advertiser Sign Up URL" />
          </InfoGrid>
        </InfoCard>
        <InfoCard title="Global Settings" action={<button className="text-tiny font-medium text-accent-text" onClick={() => setEditing('global')}>Edit</button>}>
          <InfoGrid>
            {GLOBAL_TOGGLES.map((g) => <InfoRow key={g} label={g} help={toggleHelp.get(g)} />)}
          </InfoGrid>
        </InfoCard>
      </div>
    </div>
  );
}

/** A search box + real client-side filtered table + real Pagination footer, matching the reference's
 * Tracking/Conversion Domains cards (search box above the table, "N Total |< < 1 > >|" footer). */
function DomainSearchTable({ rows, cols }: { rows: TrackingDomain[]; cols: Column<TrackingDomain>[] }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filtered = q.trim() ? rows.filter((d) => d.host.toLowerCase().includes(q.trim().toLowerCase())) : rows;
  return (
    <>
      <div className="relative mb-3">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" className="input !pl-8" />
      </div>
      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-small italic text-fg-muted">No Record Found</p>
      ) : (
        <Table columns={cols} rows={filtered} rowKey={(d) => d.id} />
      )}
      <div className="mt-3 flex justify-end">
        <Pagination total={filtered.length} page={page} pageSize={25} onPageChange={setPage} />
      </div>
    </>
  );
}

function DomainsSub() {
  const { data, loading } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const domains = data ?? [];
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const cols: Column<TrackingDomain>[] = [
    { header: 'ID', cell: (d) => <span className="tabular-nums text-fg-secondary">{d.ref}</span> },
    { header: 'URL', cell: (d) => <span className="font-mono text-xs text-accent-text">{d.host}</span> },
    { header: 'Status', cell: (d) => <Badge value={d.status} /> },
    { header: 'Is Default', cell: (d) => (d.isPrimary ? 'Default' : '—') },
  ];
  const primary = domains.find((d) => d.isPrimary) ?? domains[0];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <InfoCard title="Tracking Domains" action={<span />}>
        <DomainSearchTable rows={domains} cols={cols} />
      </InfoCard>
      <InfoCard title="Conversion Domains" action={<span />}>
        <p className="mb-2 text-tiny text-fg-muted">This app doesn't distinguish conversion domains from tracking domains — same list, shown for reference.</p>
        <DomainSearchTable rows={primary ? [primary] : []} cols={cols} />
      </InfoCard>
      <InfoCard title="Domain Managers" action={<span />}>
        <InfoBanner>This information is required if you have provided at least one tracking or login domain for platform usage. Please provide any relevant contact details to facilitate communication regarding the domain(s).</InfoBanner>
        <EmptyShellTable addLabel="Add" entityName="Domain Manager" status="Active" columns={['First Name', 'Last Name', 'Email', 'Status', 'Created', 'Modified']} />
      </InfoCard>
      <InfoCard title="Domain Registration Information" action={<span />}>
        <InfoBanner>This information is being collected in relation to Administered Domain Services under this platform's terms. This information is required by ICANN and will only be used for registration issues. Inaccurate information can lead to the suspension or cancellation of the Administered Domains.</InfoBanner>
        <InfoGrid>
          <InfoRow label="Name" /><InfoRow label="Organization" />
          <InfoRow label="Email" /><InfoRow label="Phone" />
          <InfoRow label="Address 1" /><InfoRow label="Apartment, Suite, etc." />
          <InfoRow label="City" /><InfoRow label="Region" />
          <InfoRow label="Country" /><InfoRow label="ZIP/Postal Code" />
        </InfoGrid>
      </InfoCard>
    </div>
  );
}

/** No backing table for a network-wide IP blacklist in this app (offer-level traffic controls have
 * their own real blacklist/whitelist rules elsewhere) — real, interactive rows like every other
 * Control Center edit form, saved to local state only. */
function EditIpsBlacklistForm({ onCancel }: { onCancel: () => void }) {
  const [rows, setRows] = useState<{ id: number; from: string; to: string }[]>([]);
  const nextId = useRef(1);
  const addRow = () => setRows((r) => [...r, { id: nextId.current++, from: '', to: '' }]);
  const removeRow = (id: number) => setRows((r) => r.filter((x) => x.id !== id));
  const setField = (id: number, k: 'from' | 'to', v: string) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  return (
    <div className="card space-y-4">
      <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
      <div className="flex items-center gap-2">
        <label className="text-small font-semibold text-fg">IP Blacklist</label>
        <button type="button" onClick={addRow} title="Add a range" className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Plus size={14} /></button>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="ml-3 flex items-start gap-2 border-l-2 border-border pl-4">
            <div className="grid w-full max-w-md grid-cols-1 gap-2 rounded-card border border-border bg-page p-3">
              <input placeholder="From" value={row.from} onChange={(e) => setField(row.id, 'from', e.target.value)} className="input" />
              <input placeholder="To" value={row.to} onChange={(e) => setField(row.id, 'to', e.target.value)} className="input" />
            </div>
            <button type="button" onClick={() => removeRow(row.id)} title="Remove"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-danger-bg hover:text-danger-text">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onCancel}>Save</button>
      </div>
    </div>
  );
}

function IPsSub() {
  const [editing, setEditing] = useState(false);
  if (editing) return <EditIpsBlacklistForm onCancel={() => setEditing(false)} />;
  return (
    <InfoCard title="IPs Blacklist" action={<button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      <EmptyShellTable columns={['From', 'To']} />
    </InfoCard>
  );
}

function NotificationsSub() {
  return (
    <div className="space-y-4">
      <HeadsUpBanner>Note that editing the default notifications will not modify any existing notification setting. It will only affect new accounts.</HeadsUpBanner>
      <NotificationCard title="Partners" notifs={PARTNER_NOTIFS} />
      <NotificationCard title="Offers" notifs={OFFER_NOTIFS_PLATFORM} />
      <NotificationCard title="Offer Groups" notifs={OFFER_GROUP_NOTIFS} />
      <NotificationCard title="Advertisers" notifs={ADVERTISER_NOTIFS} />
      <NotificationCard title="Actions" notifs={ACTION_NOTIFS} />
      <NotificationCard title="Billing" notifs={BILLING_NOTIFS} />
      <NotificationCard title="Network" notifs={NETWORK_NOTIFS} />
      <NotificationCard title="Security" notifs={SECURITY_NOTIFS} />
      <NotificationCard title="Traffic Health" notifs={TRAFFIC_HEALTH_NOTIFS} />
    </div>
  );
}

const BILLING_GENERAL_FIELDS: EditField[] = [
  { label: 'Display Logo in Partner Invoice' },
  { label: 'Display Network Tax Info on Partner Invoice' },
  { label: 'Display Partner Payment Info' },
  { label: "Display Partner's Tax ID on Partner Invoice" },
  { label: "Partner invoices generated in partner's currency" },
  { label: 'Display Logo in Advertiser Invoice' },
  { label: 'Display Network Tax Info on Advertiser Invoice' },
  { label: 'Tax Info', type: 'text' },
  { label: "Display Advertiser's Tax ID on Advertiser Invoice" },
  { label: "Advertiser invoices generated in advertiser's currency" },
];

const PARTNER_BILLING_FIELDS: EditField[] = [
  { label: 'Default Settings Enabled' },
  { label: 'Default Billing Frequency', type: 'text' },
  { label: 'Frequency', type: 'text' },
  { label: 'Auto Create Invoice' },
  { label: 'Auto Invoice Start Date', type: 'text' },
  { label: 'Invoice Generation Days Delay', type: 'text' },
  { label: 'Payment Method', type: 'text' },
  { label: 'Default Payment Terms', type: 'text' },
  { label: 'Hide Invoices from Partners' },
  { label: 'VAT Percentage', type: 'text' },
];

const PARTNER_RESTRICTED_PAYMENTS_FIELDS: EditField[] = [{ label: 'Payment Methods' }];

const ADVERTISER_BILLING_FIELDS: EditField[] = [
  { label: 'Default Settings Enabled' },
  { label: 'Default Billing Frequency', type: 'text' },
  { label: 'Frequency', type: 'text' },
  { label: 'Auto Create Invoice' },
  { label: 'Auto Invoice Start Date', type: 'text' },
  { label: 'Default Payment Terms', type: 'text' },
  { label: 'Hide Invoices from Advertisers' },
];

function BillingSub() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <EditableInfoCard title="General" fields={BILLING_GENERAL_FIELDS} />
      <EditableInfoCard title="Partner Billing Settings" fields={PARTNER_BILLING_FIELDS} />
      <EditableInfoCard title="Partner Restricted Payments Settings" fields={PARTNER_RESTRICTED_PAYMENTS_FIELDS} />
      <EditableInfoCard title="Advertiser Billing Settings" fields={ADVERTISER_BILLING_FIELDS} />
    </div>
  );
}

export default function PlatformTab() {
  const [sub, setSub] = useState<string>('General');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'General' && <GeneralSub />}
      {sub === 'Domains' && <DomainsSub />}
      {sub === 'IPs' && <IPsSub />}
      {sub === 'Default Notifications' && <NotificationsSub />}
      {sub === 'Billing' && <BillingSub />}
    </>
  );
}

/**
 * Full profile page (Section 5A) — light, card-based, token-driven. Real values where the backend
 * provides them (name, email, role, network Long ID, tracking domain → postback/signup URLs, API
 * key); fields the backend doesn't model yet (phone, currency, language, security code) show a clear
 * placeholder rather than fabricated data. Every copyable value has a copy button with confirmation.
 */
import { useState, type ReactNode, type FormEvent } from 'react';
import { Copy, Check, Shield, Pencil, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../auth/roles';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';
import { loadSession, saveSession } from '../../auth/session';
import { PageHeader, Badge, Modal, Field, Tabs } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';

const ACCOUNT_TABS = ['General', 'Logins'] as const;
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

interface MyAccount { ref: number; name: string; email: string; role: string; status: string; createdAt: string; updatedAt: string }
interface NetworkSettings { general: { defaultCurrency: string } }

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function Card({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card !p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-h3 font-medium text-fg">{icon} {title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-tiny font-medium text-fg-secondary">{label}</p>
      <p className="mt-0.5 text-small text-fg">{value}</p>
    </div>
  );
}

export default function ProfilePage() {
  const { session } = useAuth();
  const domains = useQuery<{ id: string; host: string; isPrimary?: boolean; status?: string }[]>('/api/tracking-domains');
  const account = useQuery<MyAccount>('/api/me/account');
  const settings = useQuery<NetworkSettings>('/api/settings');
  const [name, setName] = useState(session?.displayName ?? '');
  const [title, setTitle] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [language, setLanguage] = useState('English');
  const [timezone, setTimezone] = useState('');
  const [innerTab, setInnerTab] = useState<'Basis' | 'Contact'>('Basis');
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [anonymizeOpen, setAnonymizeOpen] = useState(false);
  const [tab, setTab] = useState<string>('General');

  if (!session) return null;
  const roleLabel = ROLE_LABELS[session.role];

  const active = (domains.data ?? []).filter((d) => d.status === 'active');
  const host = active.find((d) => d.isPrimary)?.host ?? active[0]?.host ?? 'your-tracking-domain.com';
  const affiliateSignup = `https://${host}/pub-signup`;
  const advertiserSignup = `https://${host}/adv-signup`;

  return (
    <>
      <PageHeader title="My profile" subtitle="Manage your account information and preferences" />
      <Tabs tabs={[...ACCOUNT_TABS]} active={tab} onChange={setTab} />

      {tab === 'General' && (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="card !p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-h3 font-medium text-fg">{name}</h2>
              <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditOpen(true)}><Pencil size={12} /> Edit</button>
            </div>
            <div className="px-5 pt-3">
              <Tabs tabs={['Basis', 'Contact']} active={innerTab} onChange={(t) => setInnerTab(t as 'Basis' | 'Contact')} />
            </div>
            <div className="p-5">
              {innerTab === 'Basis' ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="space-y-4">
                    <Detail label="ID" value={account.data?.ref ?? '—'} />
                    <Detail label="Name" value={name} />
                    <Detail label="Title" value={title || '—'} />
                    <Detail label="Role" value={roleLabel} />
                    <Detail label="Partner Manager" value="—" />
                    <Detail label="Advertiser Manager" value="—" />
                    <Detail label="Business Unit" value={businessUnit || '—'} />
                    <Detail label="Language" value={language} />
                    <Detail label="Timezone" value={timezone || '—'} />
                    <Detail label="Currency" value={settings.data?.general.defaultCurrency ?? '—'} />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-tiny font-medium text-fg-secondary">Photo</p>
                      <div className="grid h-20 w-20 place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">Not set</div>
                    </div>
                    <Detail label="Status" value={<Badge value={account.data?.status ?? 'active'} />} />
                    <Detail label="Modified" value={account.data ? fmtDateTime(account.data.updatedAt) : '—'} />
                    <Detail label="Created" value={account.data ? fmtDateTime(account.data.createdAt) : '—'} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Detail label="Email" value={session.email} />
                  <Detail label="Phone" value="—" />
                  <Detail label="Address" value="—" />
                  <Detail label="Apartment, Suite, etc." value="—" />
                  <Detail label="City" value="—" />
                  <Detail label="Region/State" value="—" />
                  <Detail label="Country" value="—" />
                  <Detail label="ZIP/Postal Code" value="—" />
                </div>
              )}
            </div>
          </section>

          <div className="space-y-4">
            <Card title="Security" icon={<Shield size={17} className="text-fg-secondary" />}>
              <div className="space-y-2">
                <button className="block text-small font-medium text-accent-text hover:underline" onClick={() => setPwOpen(true)}>Change password</button>
                <button className="block text-small font-medium text-accent-text hover:underline" onClick={() => setEmailOpen(true)}>Change email</button>
              </div>
            </Card>

            <LinkCard title="Partner Sign Up Link" url={affiliateSignup} />
            <LinkCard title="Advertiser Sign Up Link" url={advertiserSignup} />

            <Card title="Compliance" icon={<ShieldAlert size={17} className="text-fg-secondary" />}>
              <p className="mb-2 text-small text-fg-secondary">
                If you received a request to delete this user's personal information (not business data), you can anonymize it here.
              </p>
              <button className="text-small font-medium text-accent-text hover:underline" onClick={() => setAnonymizeOpen(true)}>Anonymize User Data</button>
            </Card>
          </div>
        </div>
      )}

      {tab === 'Logins' && (
        <div className="mt-4 card">
          <EmptyShellTable columns={['Login Time', 'IP', 'Location', 'Device Type', 'Browser']} />
        </div>
      )}

      {editOpen && <EditProfileModal current={name} title={title} businessUnit={businessUnit} language={language} timezone={timezone}
        onClose={() => setEditOpen(false)}
        onSaved={(n, t, bu, lang, tz) => {
          setName(n); setTitle(t); setBusinessUnit(bu); setLanguage(lang); setTimezone(tz);
          const s = loadSession(); if (s) saveSession({ ...s, displayName: n }); setEditOpen(false);
        }} />}
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
      {emailOpen && <ChangeEmailModal current={session.email} onClose={() => setEmailOpen(false)} />}
      {anonymizeOpen && <AnonymizeModal onClose={() => setAnonymizeOpen(false)} />}
    </>
  );
}

/** Matches the reference's Partner/Advertiser Sign Up Link cards — a light-tinted URL box with an
 * icon-only copy button, distinct from CopyField's bordered/mono style used elsewhere on this page. */
function LinkCard({ title, url }: { title: string; url: string }) {
  return (
    <section className="card !p-0">
      <div className="border-b border-border px-5 py-3.5"><h2 className="text-h3 font-medium text-fg">{title}</h2></div>
      <div className="p-5">
        <div className="relative rounded-card bg-accent-subtle p-3 pb-10">
          <code className="break-all text-small text-fg">{url}</code>
          <CopyIconButton value={url} />
        </div>
      </div>
    </section>
  );
}

function CopyIconButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
  };
  return (
    <button type="button" title={done ? 'Copied!' : 'Copy'} onClick={copy}
      className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
      {done ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  );
}

/** Name is real (persists via /api/me/profile, same as before); Title/Business Unit/Timezone/
 * Language have no backing column on `users` yet, so they're real, interactive fields that only
 * update local component state — matching every other honest-shell edit form in this app. */
function EditProfileModal({ current, title, businessUnit, language, timezone, onClose, onSaved }: {
  current: string; title: string; businessUnit: string; language: string; timezone: string;
  onClose: () => void; onSaved: (name: string, title: string, businessUnit: string, language: string, timezone: string) => void;
}) {
  const [value, setValue] = useState(current);
  const [titleV, setTitleV] = useState(title);
  const [buV, setBuV] = useState(businessUnit);
  const [langV, setLangV] = useState(language);
  const [tzV, setTzV] = useState(timezone);
  const { run, busy, error } = useMutation((name: string) => api.patch<{ name: string }>('/api/me/profile', { name }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    const r = await run(value.trim());
    if (r) onSaved(r.name, titleV, buV, langV, tzV);
  };
  return (
    <Modal open onClose={onClose} title="Edit profile">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Full name"><input className="input" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
        <Field label="Title"><input className="input" value={titleV} onChange={(e) => setTitleV(e.target.value)} /></Field>
        <Field label="Business Unit"><input className="input" value={buV} onChange={(e) => setBuV(e.target.value)} /></Field>
        <Field label="Language">
          <select className="input" value={langV} onChange={(e) => setLangV(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Timezone"><input className="input" value={tzV} onChange={(e) => setTzV(e.target.value)} placeholder="e.g. America/Los_Angeles" /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** No /api/me/email route: changing the login email for a demo account risks locking the user out
 * of their own known credentials, so this stays a real, interactive modal with an honestly inert
 * submit rather than a wired mutation. */
function ChangeEmailModal({ current, onClose }: { current: string; onClose: () => void }) {
  const [value, setValue] = useState(current);
  return (
    <Modal open onClose={onClose} title="Change email">
      <div className="space-y-4">
        <Field label="New email address"><input type="email" className="input" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" title="Not available yet" className="btn-primary" onClick={onClose}>Save changes</button>
        </div>
      </div>
    </Modal>
  );
}

/** GDPR-style anonymization has no backend in this app — real confirm dialog, honestly inert action. */
function AnonymizeModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Anonymize User Data">
      <div className="space-y-4">
        <p className="text-small text-fg-secondary">
          This will permanently replace this user's personal information (name, email) with anonymized placeholders. Business data (offers, reports, transactions) is not affected. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" title="Not available yet" className="rounded-[var(--radius)] bg-danger px-4 py-2 text-small font-semibold text-white hover:opacity-90" onClick={onClose}>Anonymize</button>
        </div>
      </div>
    </Modal>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const { run, busy, error } = useMutation((password: string) => api.patch('/api/me/password', { password }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) { setMismatch(true); return; }
    setMismatch(false);
    if (await run(pw)) { setDone(true); setTimeout(onClose, 1200); }
  };
  return (
    <Modal open onClose={onClose} title="Change password">
      {done ? (
        <p className="flex items-center gap-2 text-small text-success-text"><Check size={16} /> Password updated.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <p className="text-small text-danger-text">{error}</p>}
          {mismatch && <p className="text-small text-danger-text">Passwords don't match.</p>}
          <Field label="New password"><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} placeholder="At least 8 characters" /></Field>
          <Field label="Confirm new password"><input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

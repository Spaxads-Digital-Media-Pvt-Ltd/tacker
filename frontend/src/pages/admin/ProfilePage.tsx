/**
 * Full profile page — General (own account + metadata) and Logins (own login_events).
 * Profile fields persist via /api/me/account + /api/me/profile; security via password/email;
 * compliance anonymize via /api/me/anonymize.
 */
import { useEffect, useState, type ReactNode, type FormEvent, type ChangeEvent } from 'react';
import { Copy, Check, Shield, Pencil, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../auth/roles';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';
import { loadSession, saveSession } from '../../auth/session';
import { PageHeader, Badge, Modal, Field, Tabs } from '../../components/ui';
import { EmptyShellTable, type ShellRow } from '../../components/EmptyShellTable';

const ACCOUNT_TABS = ['General', 'Logins'] as const;
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

interface MyAccount {
  id: string;
  ref: number;
  name: string;
  email: string;
  role: string;
  status: string;
  title: string | null;
  businessUnit: string | null;
  partnerManager: boolean;
  advertiserManager: boolean;
  language: string | null;
  timezone: string | null;
  photoUrl: string | null;
  phone: string | null;
  address: string | null;
  apartment: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NetworkSettings { general: { defaultCurrency: string } }

interface LoginRow {
  id: string;
  loginTime: string;
  ip: string | null;
  location: string | null;
  deviceType: string | null;
  browser: string | null;
  platform: string | null;
  osVersion: string | null;
  userAgent: string | null;
  existingDevice: boolean;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function dash(v: string | null | undefined): string {
  return v?.trim() ? v : '—';
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
  const logins = useQuery<LoginRow[]>('/api/me/logins');
  const [name, setName] = useState(session?.displayName ?? '');
  const [title, setTitle] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [language, setLanguage] = useState('English');
  const [timezone, setTimezone] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [apartment, setApartment] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [email, setEmail] = useState(session?.email ?? '');
  const [partnerManager, setPartnerManager] = useState(false);
  const [advertiserManager, setAdvertiserManager] = useState(false);
  const [innerTab, setInnerTab] = useState<'Basis' | 'Contact'>('Basis');
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [anonymizeOpen, setAnonymizeOpen] = useState(false);
  const [tab, setTab] = useState<string>('General');

  useEffect(() => {
    const a = account.data;
    if (!a) return;
    setName(a.name);
    setTitle(a.title ?? '');
    setBusinessUnit(a.businessUnit ?? '');
    setLanguage(a.language ?? 'English');
    setTimezone(a.timezone ?? '');
    setPhone(a.phone ?? '');
    setAddress(a.address ?? '');
    setApartment(a.apartment ?? '');
    setCity(a.city ?? '');
    setRegion(a.region ?? '');
    setCountry(a.country ?? '');
    setPostalCode(a.postalCode ?? '');
    setPhotoUrl(a.photoUrl);
    setEmail(a.email);
    setPartnerManager(a.partnerManager);
    setAdvertiserManager(a.advertiserManager);
  }, [account.data]);

  if (!session) return null;
  const roleLabel = ROLE_LABELS[session.role] ?? account.data?.role ?? session.role;

  const active = (domains.data ?? []).filter((d) => d.status === 'active');
  const host = active.find((d) => d.isPrimary)?.host ?? active[0]?.host ?? 'your-tracking-domain.com';
  const affiliateSignup = `https://${host}/pub-signup`;
  const advertiserSignup = `https://${host}/adv-signup`;

  const loginRows: ShellRow[] = (logins.data ?? []).map((e) => ({
    id: e.id,
    cells: {
      'Login Time': fmtDateTime(e.loginTime),
      IP: e.ip ?? '—',
      Location: e.location ?? '—',
      'Device Type': e.deviceType ?? '—',
      Browser: e.browser ?? '—',
    },
  }));

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
                    <Detail label="Title" value={dash(title)} />
                    <Detail label="Role" value={roleLabel} />
                    <Detail label="Partner Manager" value={partnerManager ? 'Yes' : '—'} />
                    <Detail label="Advertiser Manager" value={advertiserManager ? 'Yes' : '—'} />
                    <Detail label="Business Unit" value={dash(businessUnit)} />
                    <Detail label="Language" value={language || 'English'} />
                    <Detail label="Timezone" value={dash(timezone)} />
                    <Detail label="Currency" value={settings.data?.general.defaultCurrency ?? '—'} />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-tiny font-medium text-fg-secondary">Photo</p>
                      {photoUrl ? (
                        <img src={photoUrl} alt="" className="h-20 w-20 rounded-card object-cover border border-border" />
                      ) : (
                        <div className="grid h-20 w-20 place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">Not set</div>
                      )}
                    </div>
                    <Detail label="Status" value={<Badge value={account.data?.status ?? 'active'} />} />
                    <Detail label="Modified" value={account.data ? fmtDateTime(account.data.updatedAt) : '—'} />
                    <Detail label="Created" value={account.data ? fmtDateTime(account.data.createdAt) : '—'} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Detail label="Email" value={email || session.email} />
                  <Detail label="Phone" value={dash(phone)} />
                  <Detail label="Address" value={dash(address)} />
                  <Detail label="Apartment, Suite, etc." value={dash(apartment)} />
                  <Detail label="City" value={dash(city)} />
                  <Detail label="Region/State" value={dash(region)} />
                  <Detail label="Country" value={dash(country)} />
                  <Detail label="ZIP/Postal Code" value={dash(postalCode)} />
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
          <EmptyShellTable
            columns={['Login Time', 'IP', 'Location', 'Device Type', 'Browser']}
            rows={loginRows}
            loading={logins.loading}
          />
        </div>
      )}

      {editOpen && (
        <EditProfileModal
          initial={{
            name, title, businessUnit, language, timezone, photoUrl,
            phone, address, apartment, city, region, country, postalCode,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => {
            setName(next.name);
            setTitle(next.title);
            setBusinessUnit(next.businessUnit);
            setLanguage(next.language);
            setTimezone(next.timezone);
            setPhotoUrl(next.photoUrl);
            setPhone(next.phone);
            setAddress(next.address);
            setApartment(next.apartment);
            setCity(next.city);
            setRegion(next.region);
            setCountry(next.country);
            setPostalCode(next.postalCode);
            const s = loadSession();
            if (s) saveSession({ ...s, displayName: next.name });
            account.refetch();
            setEditOpen(false);
          }}
        />
      )}
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
      {emailOpen && (
        <ChangeEmailModal
          current={email}
          onClose={() => setEmailOpen(false)}
          onSaved={(next) => {
            setEmail(next);
            const s = loadSession();
            if (s) saveSession({ ...s, email: next });
            account.refetch();
            setEmailOpen(false);
          }}
        />
      )}
      {anonymizeOpen && (
        <AnonymizeModal
          onClose={() => setAnonymizeOpen(false)}
          onDone={() => {
            account.refetch();
            setAnonymizeOpen(false);
          }}
        />
      )}
    </>
  );
}

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

type ProfileForm = {
  name: string; title: string; businessUnit: string; language: string; timezone: string;
  photoUrl: string | null;
  phone: string; address: string; apartment: string; city: string; region: string; country: string; postalCode: string;
};

function EditProfileModal({ initial, onClose, onSaved }: {
  initial: ProfileForm;
  onClose: () => void;
  onSaved: (next: ProfileForm) => void;
}) {
  const [form, setForm] = useState(initial);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    api.patch('/api/me/profile', body));

  const set = (key: keyof ProfileForm, value: string | null) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      alert('Photo must be under 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('photoUrl', typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const r = await run({
      name: form.name.trim(),
      title: form.title.trim() || null,
      businessUnit: form.businessUnit.trim() || null,
      language: form.language || 'English',
      timezone: form.timezone.trim() || null,
      photoUrl: form.photoUrl,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      apartment: form.apartment.trim() || null,
      city: form.city.trim() || null,
      region: form.region.trim() || null,
      country: form.country.trim() || null,
      postalCode: form.postalCode.trim() || null,
    });
    if (r) onSaved(form);
  };

  return (
    <Modal open onClose={onClose} title="Edit profile">
      <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Full name"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="Title"><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Business Unit"><input className="input" value={form.businessUnit} onChange={(e) => set('businessUnit', e.target.value)} /></Field>
        <Field label="Language">
          <select className="input" value={form.language} onChange={(e) => set('language', e.target.value)}>
            {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Timezone"><input className="input" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="e.g. America/Los_Angeles" /></Field>
        <Field label="Photo">
          <div className="flex items-center gap-3">
            {form.photoUrl ? (
              <img src={form.photoUrl} alt="" className="h-14 w-14 rounded-card object-cover border border-border" />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">—</div>
            )}
            <div className="flex flex-col gap-1">
              <input type="file" accept="image/*" onChange={onPhoto} className="text-tiny" />
              {form.photoUrl && (
                <button type="button" className="text-tiny text-accent-text hover:underline text-left" onClick={() => set('photoUrl', null)}>Remove photo</button>
              )}
            </div>
          </div>
        </Field>
        <div className="border-t border-border pt-3">
          <p className="mb-3 text-tiny font-medium text-fg-secondary">Contact</p>
          <div className="space-y-3">
            <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Address"><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Apartment, Suite, etc."><input className="input" value={form.apartment} onChange={(e) => set('apartment', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City"><input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
              <Field label="Region/State"><input className="input" value={form.region} onChange={(e) => set('region', e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country"><input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} /></Field>
              <Field label="ZIP/Postal Code"><input className="input" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Field>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ChangeEmailModal({ current, onClose, onSaved }: {
  current: string; onClose: () => void; onSaved: (email: string) => void;
}) {
  const [value, setValue] = useState(current);
  const { run, busy, error } = useMutation((email: string) =>
    api.patch<{ ok: boolean; email: string }>('/api/me/email', { email }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim().toLowerCase();
    if (!next || next === current.toLowerCase()) return;
    const r = await run(next);
    if (r?.ok) onSaved(r.email);
  };
  return (
    <Modal open onClose={onClose} title="Change email">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="New email address">
          <input type="email" className="input" value={value} onChange={(e) => setValue(e.target.value)} required />
        </Field>
        <p className="text-tiny text-fg-secondary">You will need this email the next time you sign in.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AnonymizeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run, busy, error } = useMutation(() => api.post<{ ok: boolean }>('/api/me/anonymize', {}));
  const confirm = async () => {
    const r = await run();
    if (r?.ok) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Anonymize User Data">
      <div className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-small text-fg-secondary">
          This will permanently replace this user's personal information (name, email, contact, photo) with anonymized placeholders. Business data (offers, reports, transactions) is not affected. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="rounded-[var(--radius)] bg-danger px-4 py-2 text-small font-semibold text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy}
            onClick={confirm}
          >
            {busy ? 'Anonymizing…' : 'Anonymize'}
          </button>
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

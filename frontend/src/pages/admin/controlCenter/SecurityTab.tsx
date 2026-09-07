/**
 * Control Center › Security — API keys, IP whitelist, login history, and MFA defaults.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { cc } from '../../../lib/controlCenter';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Tabs, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { InfoCard, InfoGrid, InfoRow, YesNoToggle, EditHeaderAction } from './shared';

const SUB_TABS = ['API Keys', 'API Whitelist', 'Logins', 'Multi-Factor Authentication'] as const;

interface ApiKey {
  id: string; prefix: string; name: string | null; scopes: string[]; status: string;
  lastUsedAt: string | null; createdAt: string;
}

function ApiKeysSub() {
  const { data, loading, error, refetch } = useQuery<ApiKey[]>('/api/keys');
  const [open, setOpen] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiKey | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const revoke = useMutation((id: string) => api.del(`/api/keys/${id}`));

  const confirmRevoke = async () => {
    if (!revokeId) return;
    const ok = await revoke.run(revokeId);
    if (ok) { setRevokeId(null); refetch(); }
  };

  const columns: Column<ApiKey>[] = [
    {
      header: 'API Key Name',
      cell: (k) => (
        <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setDetail(k)}>
          {k.name ?? `${k.prefix}…`}
        </button>
      ),
    },
    { header: 'Permissions', cell: (k) => `${k.scopes.length} permission${k.scopes.length === 1 ? '' : 's'}` },
    { header: 'Status', cell: (k) => <Badge value={k.status} /> },
    { header: 'Usage', cell: (k) => (k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never Used') },
    { header: 'Created', cell: (k) => new Date(k.createdAt).toLocaleDateString() },
    {
      header: '', className: 'text-right',
      cell: (k) => k.status === 'active'
        ? <button type="button" className="btn-ghost !py-1 !px-3 text-tiny text-danger-text hover:bg-danger-bg" onClick={() => setRevokeId(k.id)}>Revoke</button>
        : null,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ API key</button>
        {revoke.error && <p className="text-small text-danger-text">{revoke.error}</p>}
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No API keys yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(k) => k.id} />}

      <Modal open={open} onClose={() => setOpen(false)} title="New API key">
        <CreateKeyForm onClose={() => setOpen(false)} onCreated={(key) => { setOpen(false); setFreshKey(key); refetch(); }} />
      </Modal>
      <Modal open={!!freshKey} onClose={() => setFreshKey(null)} title="Copy your API key now">
        <p className="text-small text-fg-secondary">This is the only time the full key is shown. Store it securely.</p>
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-border bg-page p-3 font-mono text-tiny text-fg">{freshKey}</pre>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={() => { if (freshKey) navigator.clipboard?.writeText(freshKey); setFreshKey(null); }}>Copy &amp; close</button>
        </div>
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? 'API key'}>
        {detail && (
          <div className="space-y-3">
            <p className="font-mono text-small text-fg">{detail.prefix}…</p>
            <p className="text-small text-fg-secondary">Status: <Badge value={detail.status} /></p>
            <p className="text-small text-fg-secondary">Created {new Date(detail.createdAt).toLocaleString()}</p>
            <p className="text-small text-fg-secondary">Last used {detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleString() : 'never'}</p>
            <div>
              <p className="mb-1 text-small font-semibold text-fg">Permissions</p>
              <ul className="list-inside list-disc text-small text-fg-secondary">
                {detail.scopes.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!revokeId} onClose={() => setRevokeId(null)} title="Revoke API key">
        <p className="text-small text-fg-secondary">Revoked keys stop working immediately. This cannot be undone.</p>
        {revoke.error && <p className="mt-2 text-small text-danger-text">{revoke.error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setRevokeId(null)} disabled={revoke.busy}>Cancel</button>
          <button type="button" className="btn-primary bg-danger-bg text-danger-text" onClick={confirmRevoke} disabled={revoke.busy}>{revoke.busy ? 'Revoking…' : 'Revoke'}</button>
        </div>
      </Modal>
    </div>
  );
}

function CreateKeyForm({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { data: scopeInfo } = useQuery<{ audience: string; available: string[] }>('/api/keys/scopes');
  const available = scopeInfo?.available ?? [];
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const { run, busy, error } = useMutation((body: { name?: string; scopes?: string[] }) => api.post<{ key: string }>('/api/keys', body));

  useEffect(() => {
    if (available.length) setScopes(available);
  }, [scopeInfo]);

  const toggle = (s: string) => setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({ name: name || undefined, scopes: scopes.length ? scopes : undefined });
    if (res) onCreated(res.key);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. production integration" /></Field>
      <div>
        <p className="label mb-2 block">Permissions</p>
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-card border border-border p-3">
          {available.map((s) => (
            <label key={s} className="flex items-center gap-2 text-small text-fg">
              <input type="checkbox" className="h-4 w-4 rounded border-border" checked={scopes.includes(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
          {available.length === 0 && <p className="text-tiny text-fg-muted">Loading permissions…</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
      </div>
    </form>
  );
}

function WhitelistSub() {
  const { data, loading, refetch } = useQuery<Array<{ id: string; ipAddress: string; createdAt: string }>>('/api/control-center/api-whitelist');
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    cells: {
      'IP Address': r.ipAddress,
      Created: new Date(r.createdAt).toLocaleString(),
    },
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-card border border-border bg-accent-subtle p-4 text-small text-fg-secondary">
        <span>If you <strong>do not have any entries</strong> in your API Whitelist, then API calls from <strong>all IPs are accepted</strong>. If you have <strong>one entry or more</strong>, only calls <strong>from the IPs in the list</strong> are accepted.</span>
      </div>
      <InfoCard title="IPs whitelist" action={<span />}>
        <EmptyShellTable
          columns={['IP Address', 'Created']}
          entityName="IP"
          addLabel="IP"
          rows={rows}
          loading={loading}
          onAddSubmit={async (v) => {
            const ip = v['IP Address']?.trim();
            if (!ip) return false;
            await cc.apiWhitelist.add(ip);
            refetch();
            return true;
          }}
          onDelete={async (id) => { await cc.apiWhitelist.del(id); refetch(); }}
        />
      </InfoCard>
    </div>
  );
}

function LoginsSub() {
  const { data, loading } = useQuery<Array<{
    id: string; employee: string; ip: string | null; country: string | null; city: string | null;
    userAgent: string | null; platform: string | null; deviceType: string | null;
    osVersion: string | null; browser: string | null; existingDevice: boolean; createdAt: string;
  }>>('/api/control-center/login-events');

  const rows = (data ?? []).map((e) => ({
    id: e.id,
    cells: {
      Employee: e.employee,
      IP: e.ip ?? '—',
      Country: e.country ?? '—',
      City: e.city ?? '—',
      'User Agent': e.userAgent ?? '—',
      Platform: e.platform ?? '—',
      'Device Type': e.deviceType ?? '—',
      'OS Version': e.osVersion ?? '—',
      Browser: e.browser ?? '—',
      'Existing Device': e.existingDevice ? 'Yes' : 'No',
      'Date/Time': new Date(e.createdAt).toLocaleString(),
    },
  }));

  return (
    <EmptyShellTable
      search
      columns={['Employee', 'IP', 'Country', 'City', 'User Agent', 'Platform', 'Device Type', 'OS Version', 'Browser', 'Existing Device', 'Date/Time']}
      rows={rows}
      loading={loading}
    />
  );
}

interface UserRow {
  id: string; name: string; email: string; status: string; role: string;
}
interface LoginEvent {
  employee: string; ip: string | null; country: string | null; city: string | null;
  platform: string | null; deviceType: string | null; osVersion: string | null; createdAt: string;
}
type EmployeeMfa = { status: string; method: string; completed: boolean };

function MfaSub() {
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/security');
  const { data: users } = useQuery<UserRow[]>('/api/users');
  const { data: logins } = useQuery<LoginEvent[]>('/api/control-center/login-events');
  const mfa = (config?.mfa as Record<string, unknown> | undefined) ?? {};
  const savedEmployees = (mfa['employees'] as Record<string, EmployeeMfa> | undefined) ?? {};
  const [editing, setEditing] = useState(false);
  const [enableMfa, setEnableMfa] = useState(false);
  const [methods, setMethods] = useState('');
  const [emp, setEmp] = useState<Record<string, EmployeeMfa>>({});
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => cc.putConfig('security', body));

  const latestLogin = (user: UserRow) =>
    (logins ?? []).find((e) => e.employee === user.name || e.employee === user.email);

  useEffect(() => {
    if (editing) return;
    setEnableMfa(Boolean(mfa['enableNetworkMfa']));
    setMethods(String(mfa['supportedMethods'] ?? ''));
    const next: Record<string, EmployeeMfa> = {};
    for (const u of users ?? []) {
      next[u.id] = savedEmployees[u.id] ?? { status: u.status === 'active' ? 'active' : 'inactive', method: '', completed: false };
    }
    setEmp(next);
  }, [config, users, editing]);

  const startEdit = () => {
    setEnableMfa(Boolean(mfa['enableNetworkMfa']));
    setMethods(String(mfa['supportedMethods'] ?? ''));
    const next: Record<string, EmployeeMfa> = {};
    for (const u of users ?? []) {
      next[u.id] = savedEmployees[u.id] ?? { status: u.status === 'active' ? 'active' : 'inactive', method: '', completed: false };
    }
    setEmp(next);
    setEditing(true);
  };

  const save = async () => {
    const ok = await run({ mfa: { enableNetworkMfa: enableMfa, supportedMethods: methods, employees: emp } });
    if (ok) { setEditing(false); refetch(); }
  };

  const patchEmp = (id: string, part: Partial<EmployeeMfa>) => {
    setEmp((prev) => ({ ...prev, [id]: { ...prev[id], ...part } }));
  };

  return (
    <div className="space-y-4">
      <InfoCard title="General" action={<EditHeaderAction editing={editing} saving={busy} onEdit={startEdit} onCancel={() => setEditing(false)} onSave={save} />}>
        {editing ? (
          <div className="space-y-4">
            {error && <p className="text-small text-danger-text">{error}</p>}
            <div>
              <p className="mb-2 text-small font-semibold text-fg">Enable Network MFA</p>
              <YesNoToggle value={enableMfa} onChange={setEnableMfa} />
            </div>
            <Field label="Supported Network MFA Methods">
              <input className="input" value={methods} onChange={(e) => setMethods(e.target.value)} placeholder="e.g. Authenticator App, SMS" />
            </Field>
          </div>
        ) : (
          <InfoGrid>
            <InfoRow label="Enable Network MFA" value={mfa['enableNetworkMfa'] ? 'YES' : 'NO'} />
            <InfoRow label="Supported Network MFA Methods" value={String(mfa['supportedMethods'] ?? '')} />
          </InfoGrid>
        )}
      </InfoCard>
      <p className="text-small font-semibold text-fg">MFA Employee Settings</p>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[720px] text-left text-body">
          <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
            <tr className="divide-x divide-border">
              {['Employee', 'Status', 'Method', 'User IP', 'Country', 'City', 'Platform', 'Device Type', 'OS Version', 'Completed'].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(users ?? []).map((u) => {
              const st = emp[u.id] ?? { status: 'inactive', method: '', completed: false };
              const login = latestLogin(u);
              return (
                <tr key={u.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-fg">{u.name}</td>
                  <td className="px-4 py-3">
                    {editing ? (
                      <select className="input !w-28 !py-1" value={st.status} onChange={(e) => patchEmp(u.id, { status: e.target.value })}>
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                    ) : <span className="text-small text-fg-secondary">{st.status}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {editing
                      ? <input className="input !w-40 !py-1" value={st.method} onChange={(e) => patchEmp(u.id, { method: e.target.value })} placeholder="Authenticator" />
                      : <span className="text-small text-fg-secondary">{st.method || '—'}</span>}
                  </td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{login?.ip ?? '—'}</td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{login?.country ?? '—'}</td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{login?.city ?? '—'}</td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{login?.platform ?? '—'}</td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{login?.deviceType ?? '—'}</td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{login?.osVersion ?? '—'}</td>
                  <td className="px-4 py-3">
                    {editing
                      ? <YesNoToggle value={st.completed} onChange={(completed) => patchEmp(u.id, { completed })} />
                      : <span className="text-small text-fg-secondary">{st.completed ? 'Yes' : 'No'}</span>}
                  </td>
                </tr>
              );
            })}
            {(!users || users.length === 0) && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-small italic text-fg-muted">No employees found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SecurityTab() {
  const [sub, setSub] = useState<string>('API Keys');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'API Keys' && <ApiKeysSub />}
      {sub === 'API Whitelist' && <WhitelistSub />}
      {sub === 'Logins' && <LoginsSub />}
      {sub === 'Multi-Factor Authentication' && <MfaSub />}
    </>
  );
}

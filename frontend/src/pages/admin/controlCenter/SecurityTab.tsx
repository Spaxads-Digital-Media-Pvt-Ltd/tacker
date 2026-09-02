/**
 * Control Center › Security. API Keys is real (network-level keys via /api/keys, same backend the
 * portal API Keys page uses). API Whitelist, Logins, and MFA have no backend concept at all here.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { cc } from '../../../lib/controlCenter';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Tabs, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { InfoCard, InfoGrid, InfoRow, YesNoToggle } from './shared';

const SUB_TABS = ['API Keys', 'API Whitelist', 'Logins', 'Multi-Factor Authentication'] as const;

interface ApiKey {
  id: string; prefix: string; name: string | null; scopes: string[]; status: string;
  lastUsedAt: string | null; createdAt: string;
}

function ApiKeysSub() {
  const { data, loading, error, refetch } = useQuery<ApiKey[]>('/api/keys');
  const [open, setOpen] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const revoke = useMutation((id: string) => api.del(`/api/keys/${id}`));

  const columns: Column<ApiKey>[] = [
    { header: 'API Key Name', cell: (k) => <span className="font-medium text-accent-text">{k.name ?? `${k.prefix}…`}</span> },
    { header: 'Permissions', cell: (k) => `${k.scopes.length} permission${k.scopes.length === 1 ? '' : 's'}` },
    { header: 'Status', cell: (k) => <Badge value={k.status} /> },
    { header: 'Usage', cell: (k) => (k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never Used') },
    { header: 'Created', cell: (k) => new Date(k.createdAt).toLocaleDateString() },
    {
      header: '', className: 'text-right',
      cell: (k) => k.status === 'active'
        ? <button className="btn-ghost !py-1 !px-3 text-tiny text-danger-text hover:bg-danger-bg" onClick={async () => { if (await revoke.run(k.id)) refetch(); }}>Revoke</button>
        : null,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button className="btn-primary" onClick={() => setOpen(true)}>+ API key</button>
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
          <button className="btn-primary" onClick={() => { if (freshKey) navigator.clipboard?.writeText(freshKey); setFreshKey(null); }}>Copy &amp; close</button>
        </div>
      </Modal>
    </div>
  );
}

function CreateKeyForm({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const { run, busy, error } = useMutation((body: { name?: string }) => api.post<{ key: string }>('/api/keys', body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(name ? { name } : {});
    if (res) onCreated(res.key);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. production integration" /></Field>
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
    cells: { 'IP Address': r.ipAddress },
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-card border border-border bg-accent-subtle p-4 text-small text-fg-secondary">
        <span>If you <strong>do not have any entries</strong> in your API Whitelist, then API calls from <strong>all IPs are accepted</strong>. If you have <strong>one entry or more</strong>, only calls <strong>from the IPs in the list</strong> are accepted.</span>
      </div>
      <InfoCard title="IPs whitelist">
        <EmptyShellTable
          columns={['IP Address']}
          entityName="IP"
          addLabel="IP"
          rows={rows}
          loading={loading}
          onAddSubmit={async (v) => {
            const ip = v['IP Address'];
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

function MfaSub() {
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/security');
  const mfa = (config?.mfa as Record<string, unknown> | undefined) ?? {};
  const [editing, setEditing] = useState(false);
  const [enableMfa, setEnableMfa] = useState(false);
  const [methods, setMethods] = useState('');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => cc.putConfig('security', body));

  const startEdit = () => {
    setEnableMfa(Boolean(mfa['enableNetworkMfa']));
    setMethods(String(mfa['supportedMethods'] ?? ''));
    setEditing(true);
  };

  const save = async () => {
    const ok = await run({ mfa: { enableNetworkMfa: enableMfa, supportedMethods: methods } });
    if (ok) { setEditing(false); refetch(); }
    return !!ok;
  };

  return (
    <div className="space-y-4">
      <InfoCard title="General" action={editing ? <span /> : <button className="text-tiny font-medium text-accent-text" onClick={startEdit}>Edit</button>}>
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
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <InfoGrid>
            <InfoRow label="Enable Network MFA" value={mfa['enableNetworkMfa'] ? 'YES' : 'NO'} />
            <InfoRow label="Supported Network MFA Methods" value={String(mfa['supportedMethods'] ?? '')} />
          </InfoGrid>
        )}
      </InfoCard>
      <p className="text-small font-semibold text-fg">MFA Employee Settings</p>
      <EmptyShellTable status="All" columns={['Employee', 'Status', 'Method', 'User IP', 'Country', 'City', 'Platform', 'Device Type', 'OS Version', 'Completed']} />
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

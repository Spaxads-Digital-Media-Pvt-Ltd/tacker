/**
 * Super Admin › Team & roles — the platform's own team. Members: who has access and with which role; add,
 * change role, disable / enable (never yourself — a disabled member is out at once), reset another's
 * password, change your own. Roles: the built-in ones (Owner, Admin, Sales, Account Manager, Support,
 * Finance, Read-only) and custom ones — each section Hidden / Read / Full (Everflow-style), all networks or
 * only the ones a member manages or sold, and the page it lands on. Roles and the Owner role are an Owner's.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { usePlatformMe, type Level } from '../../lib/platformMe';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, Tabs, type Column } from '../../shared-components/primitives/ui';
import { PASSWORD_HINT, PASSWORD_MIN } from '../../auth/passwordPolicy';

interface Member {
  id: string; email: string; name: string | null; status: 'active' | 'disabled'; created_at: string; last_login_at: string | null;
  role_id: string; role_key: string; role_name: string; you: boolean;
}
interface Role {
  id: string; key: string; name: string; description: string | null; scope: 'all' | 'assigned'; home: string;
  is_system: boolean; members: number; permissions: Record<string, Level>;
}
const HOMES = [
  { value: '/admin', label: 'Overview' }, { value: '/admin/networks', label: 'Networks' }, { value: '/admin/sales', label: 'Sales dashboard' },
  { value: '/admin/success', label: 'Customer health' }, { value: '/admin/support', label: 'Support tickets' }, { value: '/admin/billing', label: 'Invoices' },
  { value: '/admin/revenue', label: 'Revenue' },
];
const LEVEL_LABEL: Record<Level, string> = { none: 'Hidden', read: 'Read', full: 'Full' };

export default function Team() {
  const { me, can } = usePlatformMe();
  const [tab, setTab] = useState('Members');
  const members = useQuery<Member[]>('/platform/admins');
  const roles = useQuery<Role[]>('/platform/roles');
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [editingRole, setEditingRole] = useState<Role | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manage = can('team', 'full');
  const owner = me?.role.key === 'owner';

  const setStatus = (m: Member, status: 'active' | 'disabled') => confirm({
    title: `${status === 'disabled' ? 'Disable' : 'Enable'} ${m.email}?`, confirmLabel: status === 'disabled' ? 'Disable' : 'Enable', destructive: status === 'disabled',
    message: status === 'disabled' ? 'They are signed out at once and can’t sign in until enabled again.' : 'They can sign in again.',
    onConfirm: async () => { await api.patch(`/platform/admins/${m.id}`, { status }); setNotice(null); members.refetch(); },
  });
  const changeRole = async (m: Member, roleId: string) => {
    setError(null); setNotice(null);
    try {
      await api.patch(`/platform/admins/${m.id}`, { roleId });
      setNotice(`${m.email} is now ${(roles.data ?? []).find((r) => r.id === roleId)?.name ?? 'updated'}.`);
      members.refetch(); roles.refetch();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the role'); members.refetch(); }
  };
  const deleteRole = (r: Role) => confirm({
    title: `Delete the role ${r.name}?`, confirmLabel: 'Delete', destructive: true, message: 'Members must have another role first.',
    onConfirm: async () => { await api.del(`/platform/roles/${r.id}`); roles.refetch(); },
  });

  const roleOptions = (current: string) => (roles.data ?? []).filter((r) => owner || r.key !== 'owner' || r.id === current);
  const memberCols: Column<Member>[] = [
    { header: 'Member', cell: (m) => <div><p className="font-medium">{m.name || m.email}{m.you && <span className="ml-2 text-tiny font-normal text-fg-muted">(you)</span>}</p>{m.name && <p className="text-tiny text-fg-muted">{m.email}</p>}</div> },
    {
      header: 'Role', cell: (m) => (manage && !m.you && (owner || m.role_key !== 'owner')
        ? (
          <select className="input !py-1 text-small" value={m.role_id} onChange={(e) => void changeRole(m, e.target.value)} aria-label={`Role of ${m.email}`}>
            {roleOptions(m.role_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )
        : <Badge value="active" label={m.role_name} />),
    },
    { header: 'Status', cell: (m) => <Badge value={m.status} /> },
    { header: 'Last sign-in', cell: (m) => (m.last_login_at ? new Date(m.last_login_at).toLocaleString() : <span className="text-fg-muted">never</span>) },
    {
      header: '', className: 'text-right', cell: (m) => (!manage || m.you ? null : (
        <span className="flex justify-end gap-3 whitespace-nowrap">
          {(owner || m.role_key !== 'owner') && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setResetting(m)}>Reset password</button>}
          {m.status === 'active'
            ? <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => setStatus(m, 'disabled')}>Disable</button>
            : <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setStatus(m, 'active')}>Enable</button>}
        </span>
      )),
    },
  ];

  return (
    <>
      <PageHeader title="Team & roles" subtitle="Your platform team — who has access, and what each role may do."
        action={tab === 'Members' && manage ? <button className="btn-primary" onClick={() => setAdding(true)}>Add member</button>
          : tab === 'Roles' && owner ? <button className="btn-primary" onClick={() => setEditingRole('new')}>New role</button> : undefined} />
      <div className="mb-4"><Tabs tabs={['Members', 'Roles']} active={tab} onChange={(t) => { setTab(t); setNotice(null); setError(null); }} /></div>
      {notice && <p className="mb-3 text-small text-success-text">{notice}</p>}
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}

      {tab === 'Members' ? (
        <>
          {members.loading ? <StateBlock><Spinner /></StateBlock>
            : members.error ? <StateBlock>{members.error}</StateBlock>
            : <Table columns={memberCols} rows={members.data ?? []} rowKey={(m) => m.id} />}
          <OwnPassword onDone={() => setNotice('Your password was changed. Use it at your next sign-in.')} />
        </>
      ) : roles.loading ? <StateBlock><Spinner /></StateBlock>
        : roles.error ? <StateBlock>{roles.error}</StateBlock>
        : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {(roles.data ?? []).map((r) => (
              <div key={r.id} className="card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-h3 font-semibold text-fg">{r.name} <span className="ml-1 text-tiny font-normal text-fg-muted">{r.is_system ? 'built-in' : 'custom'}</span></p>
                    {r.description && <p className="text-small text-fg-secondary">{r.description}</p>}
                    <p className="mt-1 text-tiny text-fg-muted">
                      {r.scope === 'assigned' ? 'Only the networks they manage or sold' : 'All networks'} · lands on {HOMES.find((h) => h.value === r.home)?.label ?? r.home} · {r.members} member(s)
                    </p>
                  </div>
                  {owner && r.key !== 'owner' && (
                    <span className="flex shrink-0 gap-3">
                      <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setEditingRole(r)}>Edit</button>
                      {!r.is_system && <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => deleteRole(r)}>Delete</button>}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(me?.sections ?? []).map((s) => {
                    const l = r.permissions[s.key] ?? 'none';
                    return (
                      <span key={s.key} title={s.description}
                        className={`rounded-full px-2 py-0.5 text-tiny ${l === 'full' ? 'bg-success-bg text-success-text' : l === 'read' ? 'bg-accent-subtle text-accent-text' : 'bg-page text-fg-muted line-through'}`}>
                        {s.name}{l === 'read' ? ' · read' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

      {adding && <AddMember roles={roleOptions('')} onClose={() => setAdding(false)} onDone={(email) => { setAdding(false); setNotice(`${email} can now sign in to the Super Admin console.`); members.refetch(); roles.refetch(); }} />}
      {resetting && <ResetPassword member={resetting} onClose={() => setResetting(null)} onDone={() => { setNotice(`${resetting.email}’s password was reset — pass it to them.`); setResetting(null); }} />}
      {editingRole && <RoleForm role={editingRole === 'new' ? null : editingRole} sections={me?.sections ?? []} onClose={() => setEditingRole(null)} onSaved={(name) => { setEditingRole(null); setNotice(`Role ${name} saved — it applies at once.`); roles.refetch(); }} />}
    </>
  );
}

function PasswordPair({ value, confirmValue, onChange, onConfirmChange, label = 'Password' }: {
  value: string; confirmValue: string; onChange: (v: string) => void; onConfirmChange: (v: string) => void; label?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={label} hint={PASSWORD_HINT}><input className="input" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} /></Field>
      <Field label="Confirm"><input className="input" type="password" required autoComplete="new-password" value={confirmValue} onChange={(e) => onConfirmChange(e.target.value)} /></Field>
    </div>
  );
}

function AddMember({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const m = useMutation((b: Record<string, unknown>) => api.post('/platform/admins', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMismatch(true); return; }
    setMismatch(false);
    if (await m.run({ email: email.trim(), name: name.trim() || undefined, password: pw, roleId })) onDone(email.trim());
  };
  return (
    <Modal open onClose={onClose} title="Add a team member">
      <form onSubmit={submit} className="space-y-4">
        {(m.error || mismatch) && <p className="text-small text-danger-text">{mismatch ? 'The passwords don’t match.' : m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Name" hint="Optional"><input className="input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Field label="Role">
          <select className="input" required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="" disabled>Choose a role…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>)}
          </select>
        </Field>
        <PasswordPair value={pw} confirmValue={pw2} onChange={setPw} onConfirmChange={setPw2} />
        <p className="text-tiny text-fg-secondary">They sign in with “Sign in as Super Admin” and land on their role’s panel. Pass them the password yourself; they can change it under Team.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !roleId}>{m.busy ? 'Adding…' : 'Add member'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const m = useMutation((b: { password: string }) => api.post(`/platform/admins/${member.id}/password`, b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMismatch(true); return; }
    setMismatch(false);
    if (await m.run({ password: pw })) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Reset ${member.email}’s password`}>
      <form onSubmit={submit} className="space-y-4">
        {(m.error || mismatch) && <p className="text-small text-danger-text">{mismatch ? 'The passwords don’t match.' : m.error}</p>}
        <PasswordPair label="New password" value={pw} confirmValue={pw2} onChange={setPw} onConfirmChange={setPw2} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Reset password'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RoleForm({ role, sections, onClose, onSaved }: {
  role: Role | null; sections: { key: string; name: string; description: string }[]; onClose: () => void; onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [scope, setScope] = useState<'all' | 'assigned'>(role?.scope ?? 'all');
  const [home, setHome] = useState(role?.home ?? '/admin');
  const [perms, setPerms] = useState<Record<string, Level>>(() => Object.fromEntries(sections.map((s) => [s.key, role?.permissions[s.key] ?? 'none'])));
  const m = useMutation((b: Record<string, unknown>) => (role ? api.patch(`/platform/roles/${role.id}`, b) : api.post('/platform/roles', b)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await m.run({ name: name.trim(), description: description.trim() || null, scope, home, permissions: perms })) onSaved(name.trim());
  };
  return (
    <Modal open size="xl" onClose={onClose} title={role ? `Edit ${role.name}` : 'New role'}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name"><input className="input" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Lands on"><select className="input" value={home} onChange={(e) => setHome(e.target.value)}>{HOMES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}</select></Field>
        </div>
        <Field label="Description" hint="Optional"><input className="input" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-4 text-small text-fg">
          <label className="flex items-center gap-2"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All networks</label>
          <label className="flex items-center gap-2"><input type="radio" checked={scope === 'assigned'} onChange={() => setScope('assigned')} /> Only the networks they manage or sold</label>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius)] border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny uppercase tracking-wide text-fg-secondary">
              <tr><th className="px-3 py-2 text-left">Section</th>{(['none', 'read', 'full'] as Level[]).map((l) => <th key={l} className="px-3 py-2 text-center">{LEVEL_LABEL[l]}</th>)}</tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <tr key={s.key} className="border-t border-border">
                  <td className="px-3 py-2"><p className="font-medium text-fg">{s.name}</p><p className="text-tiny text-fg-muted">{s.description}</p></td>
                  {(['none', 'read', 'full'] as Level[]).map((l) => (
                    <td key={l} className="px-3 py-2 text-center">
                      <input type="radio" name={`perm-${s.key}`} aria-label={`${s.name}: ${LEVEL_LABEL[l]}`} checked={perms[s.key] === l} onChange={() => setPerms((p) => ({ ...p, [s.key]: l }))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Save role'}</button>
        </div>
      </form>
    </Modal>
  );
}

function OwnPassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const m = useMutation((b: { currentPassword: string; newPassword: string }) => api.post('/platform/me/password', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMismatch(true); return; }
    setMismatch(false);
    if (await m.run({ currentPassword: current, newPassword: pw })) { setCurrent(''); setPw(''); setPw2(''); onDone(); }
  };
  return (
    <form onSubmit={submit} className="card mt-6 max-w-2xl space-y-4">
      <h3 className="text-h3 font-medium text-fg">Your account · change password</h3>
      {(m.error || mismatch) && <p className="text-small text-danger-text">{mismatch ? 'The new passwords don’t match.' : m.error}</p>}
      <Field label="Current password"><input className="input max-w-sm" type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <PasswordPair label="New password" value={pw} confirmValue={pw2} onChange={setPw} onConfirmChange={setPw2} />
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Change password'}</button></div>
    </form>
  );
}

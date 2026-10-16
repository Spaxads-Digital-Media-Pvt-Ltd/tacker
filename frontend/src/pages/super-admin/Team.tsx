/**
 * Super Admin › Team — the platform's Super Admin accounts (until now only the command line could add one):
 * add one, disable / enable (never yourself — a disabled one is out at once), reset another's password,
 * and change your own (with your current one). Every change is in the activity log.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import { PASSWORD_HINT, PASSWORD_MIN } from '../../auth/passwordPolicy';

interface PlatformAdmin { id: string; email: string; name: string | null; status: 'active' | 'disabled'; created_at: string; last_login_at: string | null; you: boolean }

export default function Team() {
  const admins = useQuery<PlatformAdmin[]>('/platform/admins');
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<PlatformAdmin | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setStatus = (a: PlatformAdmin, status: 'active' | 'disabled') => confirm({
    title: `${status === 'disabled' ? 'Disable' : 'Enable'} ${a.email}?`, confirmLabel: status === 'disabled' ? 'Disable' : 'Enable', destructive: status === 'disabled',
    message: status === 'disabled' ? 'They are signed out at once and can’t sign in until enabled again.' : 'They can sign in again.',
    onConfirm: async () => { await api.patch(`/platform/admins/${a.id}`, { status }); setNotice(null); admins.refetch(); },
  });

  const columns: Column<PlatformAdmin>[] = [
    { header: 'Super Admin', cell: (a) => <div><p className="font-medium">{a.name || a.email}{a.you && <span className="ml-2 text-tiny font-normal text-fg-muted">(you)</span>}</p>{a.name && <p className="text-tiny text-fg-muted">{a.email}</p>}</div> },
    { header: 'Status', cell: (a) => <Badge value={a.status} /> },
    { header: 'Last sign-in', cell: (a) => (a.last_login_at ? new Date(a.last_login_at).toLocaleString() : <span className="text-fg-muted">never</span>) },
    { header: 'Added', cell: (a) => new Date(a.created_at).toLocaleDateString() },
    {
      header: '', className: 'text-right', cell: (a) => (a.you ? <span className="text-tiny text-fg-muted">—</span> : (
        <span className="flex justify-end gap-3 whitespace-nowrap">
          <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setResetting(a)}>Reset password</button>
          {a.status === 'active'
            ? <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => setStatus(a, 'disabled')}>Disable</button>
            : <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setStatus(a, 'active')}>Enable</button>}
        </span>
      )),
    },
  ];

  return (
    <>
      <PageHeader title="Team" subtitle="Super Admin accounts — who can manage the platform."
        action={<button className="btn-primary" onClick={() => setAdding(true)}>Add Super Admin</button>} />
      {notice && <p className="mb-3 text-small text-success-text">{notice}</p>}
      {admins.loading ? <StateBlock><Spinner /></StateBlock>
        : admins.error ? <StateBlock>{admins.error}</StateBlock>
        : <Table columns={columns} rows={admins.data ?? []} rowKey={(a) => a.id} />}
      <OwnPassword onDone={() => setNotice('Your password was changed. Use it at your next sign-in.')} />
      {adding && <AddAdmin onClose={() => setAdding(false)} onDone={(email) => { setAdding(false); setNotice(`${email} can now sign in as a Super Admin.`); admins.refetch(); }} />}
      {resetting && <ResetPassword admin={resetting} onClose={() => setResetting(null)} onDone={() => { setNotice(`${resetting.email}’s password was reset — pass it to them.`); setResetting(null); }} />}
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

function AddAdmin({ onClose, onDone }: { onClose: () => void; onDone: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const m = useMutation((b: Record<string, unknown>) => api.post('/platform/admins', b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMismatch(true); return; }
    setMismatch(false);
    if (await m.run({ email: email.trim(), name: name.trim() || undefined, password: pw })) onDone(email.trim());
  };
  return (
    <Modal open onClose={onClose} title="Add a Super Admin">
      <form onSubmit={submit} className="space-y-4">
        {(m.error || mismatch) && <p className="text-small text-danger-text">{mismatch ? 'The passwords don’t match.' : m.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Name" hint="Optional"><input className="input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <PasswordPair value={pw} confirmValue={pw2} onChange={setPw} onConfirmChange={setPw2} />
        <p className="text-tiny text-fg-secondary">They sign in on the login page with “Sign in as Super Admin”. Pass them the password yourself; they can change it under Team.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Adding…' : 'Add Super Admin'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ admin, onClose, onDone }: { admin: PlatformAdmin; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const m = useMutation((b: { password: string }) => api.post(`/platform/admins/${admin.id}/password`, b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setMismatch(true); return; }
    setMismatch(false);
    if (await m.run({ password: pw })) onDone();
  };
  return (
    <Modal open onClose={onClose} title={`Reset ${admin.email}’s password`}>
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

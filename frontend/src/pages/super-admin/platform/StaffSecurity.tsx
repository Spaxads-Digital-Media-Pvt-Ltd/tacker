/**
 * Super Admin › staff security panels — signed-in sessions (sign one out, every other one, or — for an
 * Owner / team manager — a member everywhere) and sign-in history (address, browser, outcome). Used on
 * Team (your account; a member's access) and Settings › Security (the whole team's sign-ins).
 */
import { useState } from 'react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { Modal, Spinner, StateBlock, Table, type Column } from '../../../shared-components/primitives/ui';

export interface StaffSession {
  id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string;
  revokedAt: string | null; active: boolean; current?: boolean;
}
export interface SignIn {
  id: string; adminId: string | null; email: string | null; name: string | null; ip: string | null; userAgent: string | null; outcome: string; createdAt: string;
}

const OUTCOME: Record<string, { label: string; ok?: boolean }> = {
  success: { label: 'Signed in', ok: true }, bad_password: { label: 'Wrong password' }, unknown_email: { label: 'Unknown email' },
  disabled: { label: 'Account disabled' }, blocked_ip: { label: 'Address not allowed' }, mfa_required: { label: 'Two-factor asked' },
  mfa_failed: { label: 'Wrong two-factor code' }, locked: { label: 'Too many attempts' },
};

/** "Chrome on macOS" from a user-agent string — enough to recognise a device. */
function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return browser && os ? `${browser} on ${os}` : browser ?? os ?? ua.slice(0, 40);
}
const when = (iso: string) => new Date(iso).toLocaleString();

/** Sessions at `path`; `self` = your own (sign one out / every other one), otherwise read-only rows. */
export function SessionList({ path, self = false }: { path: string; self?: boolean }) {
  const q = useQuery<StaffSession[]>(path);
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  if (q.loading && !q.data) return <StateBlock><Spinner /></StateBlock>;
  if (q.error || !q.data) return <StateBlock>{q.error ?? 'Could not load the sessions'}</StateBlock>;
  const active = q.data.filter((s) => s.active);
  const ended = q.data.filter((s) => !s.active);
  const signOut = async (s: StaffSession) => {
    setError(null);
    try { await api.del(`/platform/me/sessions/${s.id}`); q.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign it out'); }
  };
  const others = active.filter((s) => !s.current).length;
  return (
    <div className="space-y-2">
      {error && <p className="text-small text-danger-text">{error}</p>}
      {active.length === 0 && <p className="text-small text-fg-muted">No signed-in sessions.</p>}
      <ul className="divide-y divide-border rounded-[var(--radius)] ring-1 ring-inset ring-border">
        {active.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-small text-fg">{deviceLabel(s.userAgent)}{s.current && <span className="ml-2 text-tiny font-medium text-success-text">this session</span>}</p>
              <p className="text-tiny text-fg-muted">{s.ip ?? 'unknown address'} · signed in {when(s.createdAt)} · last active {when(s.lastSeenAt)}</p>
            </div>
            {self && !s.current && <button className="shrink-0 text-tiny font-medium text-danger-text hover:underline" onClick={() => void signOut(s)}>Sign out</button>}
          </li>
        ))}
      </ul>
      {self && others > 0 && (
        <button className="btn-ghost" onClick={() => confirm({
          title: 'Sign out everywhere else?', confirmLabel: 'Sign out', destructive: true,
          message: `${others} other session(s) end at once; this one stays signed in.`,
          onConfirm: async () => { await api.post('/platform/me/sessions/revoke-others', {}); q.refetch(); },
        })}>Sign out everywhere else</button>
      )}
      {ended.length > 0 && <p className="text-tiny text-fg-muted">{ended.length} ended in the last 7 days ({ended.filter((s) => s.revokedAt).length} signed out).</p>}
    </div>
  );
}

/** Sign-in history at `path` (/platform/me/sign-ins, /platform/admins/:id/sign-ins or /platform/security/sign-ins). */
export function SignInTable({ path, showWho = false, limit = 25 }: { path: string; showWho?: boolean; limit?: number }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const q = useQuery<SignIn[]>(path, { limit, ...(failedOnly ? { failed: '1' } : {}) });
  const cols: Column<SignIn>[] = [
    { header: 'When', cell: (e) => <span className="whitespace-nowrap">{when(e.createdAt)}</span> },
    ...(showWho ? [{ header: 'Who', cell: (e: SignIn) => <span>{e.name || e.email || '—'}</span> }] : []),
    { header: 'Result', cell: (e) => { const o = OUTCOME[e.outcome]; return <span className={o?.ok ? 'text-success-text' : 'text-danger-text'}>{o?.label ?? e.outcome}</span>; } },
    { header: 'Address', cell: (e) => <span className="font-mono text-tiny">{e.ip ?? '—'}</span> },
    { header: 'Device', cell: (e) => <span className="text-fg-secondary">{deviceLabel(e.userAgent)}</span> },
  ];
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-small text-fg-secondary">
        <input type="checkbox" className="h-4 w-4" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed attempts only
      </label>
      {q.loading && !q.data ? <StateBlock><Spinner /></StateBlock>
        : q.error ? <StateBlock>{q.error}</StateBlock>
        : (q.data ?? []).length === 0 ? <p className="text-small text-fg-muted">No sign-ins recorded.</p>
        : <Table columns={cols} rows={q.data ?? []} rowKey={(e) => e.id} />}
    </div>
  );
}

/** Team › Your account — your sessions and your recent sign-ins. */
export function YourSessions() {
  return (
    <div className="card space-y-4">
      <div>
        <h3 className="text-h3 font-medium text-fg">Your account · where you’re signed in</h3>
        <p className="text-small text-fg-secondary">Don’t recognise one? Sign it out and change your password.</p>
      </div>
      <SessionList path="/platform/me/sessions" self />
      <h4 className="text-small font-semibold text-fg">Recent sign-ins</h4>
      <SignInTable path="/platform/me/sign-ins" limit={10} />
    </div>
  );
}

/** A member's sessions and sign-ins (team:read); "Sign out everywhere" needs team:full. */
export function MemberAccess({ member, canSignOut, onClose }: { member: { id: string; email: string }; canSignOut: boolean; onClose: () => void }) {
  const confirm = useConfirm();
  const [key, setKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`${member.email} · sessions & sign-ins`} size="xl"
      footer={canSignOut ? (
        <button className="btn-danger" onClick={() => confirm({
          title: `Sign ${member.email} out everywhere?`, confirmLabel: 'Sign out everywhere', destructive: true,
          message: 'Every session they have ends at once; they can sign in again (disable them to keep them out).',
          onConfirm: async () => {
            const r = await api.post<{ revoked: number }>(`/platform/admins/${member.id}/sessions/revoke-all`, {});
            setNotice(`${r.revoked} session(s) signed out.`); setKey((k) => k + 1);
          },
        })}>Sign out everywhere</button>
      ) : undefined}>
      <div className="space-y-4">
        {notice && <p className="text-small text-success-text">{notice}</p>}
        <h4 className="text-small font-semibold text-fg">Signed-in sessions</h4>
        <SessionList key={key} path={`/platform/admins/${member.id}/sessions`} />
        <h4 className="text-small font-semibold text-fg">Sign-ins</h4>
        <SignInTable path={`/platform/admins/${member.id}/sign-ins`} />
      </div>
    </Modal>
  );
}

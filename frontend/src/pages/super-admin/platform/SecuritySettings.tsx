/**
 * Super Admin › Settings › Security — require two-factor sign-in for every member of the platform team;
 * the IP allowlist (when set, the console can only be signed in to and used from these addresses / CIDR
 * ranges — a list without your own address can't be saved); the team's sign-ins (team:read).
 */
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { SignInTable } from './StaffSecurity';

interface Security { requireTwoFactor: boolean; ipAllowlist: string[]; yourIp: string | null }

export function SecuritySettings() {
  const { can, me, refetch } = usePlatformMe();
  const s = useQuery<Security>('/platform/settings/security');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState('');
  const [listError, setListError] = useState<string | null>(null);
  const [listSaved, setListSaved] = useState(false);
  useEffect(() => { if (s.data) setList(s.data.ipAllowlist.join('\n')); }, [s.data]);
  if (s.loading && !s.data) return <StateBlock><Spinner /></StateBlock>;
  if (s.error || !s.data) return <StateBlock>{s.error ?? 'Could not load the security settings'}</StateBlock>;
  const edit = can('settings', 'full');
  const toggle = async (on: boolean) => {
    setError(null); setBusy(true);
    try { await api.put('/platform/settings/security', { requireTwoFactor: on }); s.refetch(); refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const entries = list.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const saveList = async () => {
    setListError(null); setListSaved(false); setBusy(true);
    try { await api.put('/platform/settings/security', { ipAllowlist: entries }); setListSaved(true); s.refetch(); }
    catch (e) { setListError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const yourIp = s.data.yourIp;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-3">
        <h3 className="text-h3 font-medium text-fg">Two-factor sign-in</h3>
        <label className="flex items-start gap-3 text-small text-fg">
          <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={!edit || busy} checked={s.data.requireTwoFactor} onChange={(e) => void toggle(e.target.checked)} />
          <span>Require it for every member of the platform team. Members without it can only set it up until they do; nobody can turn theirs off.</span>
        </label>
        {!me?.twoFactor?.enabled && <p className="text-tiny text-fg-muted">Turn it on for your own account first (Team › Your account).</p>}
        {error && <p className="text-small text-danger-text">{error}</p>}
      </div>

      <div className="card space-y-3">
        <div>
          <h3 className="text-h3 font-medium text-fg">IP allowlist</h3>
          <p className="text-small text-fg-secondary">
            When set, the console can only be signed in to and used from these addresses — one per line, a single address (203.0.113.7) or a range (203.0.113.0/24, 2001:db8::/32). Leave it empty to allow any address.
          </p>
        </div>
        <textarea className="input min-h-[120px] font-mono text-small" disabled={!edit || busy} value={list}
          onChange={(e) => { setList(e.target.value); setListSaved(false); }} placeholder={'203.0.113.0/24\n198.51.100.7'} aria-label="Allowed addresses" />
        <p className="text-tiny text-fg-muted">
          Your current address: <span className="font-mono">{yourIp ?? 'unknown'}</span>
          {edit && yourIp && !entries.includes(yourIp) && entries.length > 0 && (
            <button type="button" className="ml-2 font-medium text-accent-text hover:underline" onClick={() => setList((l) => `${l.trim()}\n${yourIp}`.trim())}>Add it</button>
          )}
        </p>
        {listError && <p className="text-small text-danger-text">{listError}</p>}
        {listSaved && !listError && <p className="text-small text-success-text">{entries.length ? `Saved — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}; applies at once.` : 'Saved — any address is allowed.'}</p>}
        {edit && <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={() => void saveList()}>{busy ? 'Saving…' : 'Save allowlist'}</button></div>}
      </div>

      {can('team', 'read') && (
        <div className="card space-y-3">
          <div>
            <h3 className="text-h3 font-medium text-fg">Team sign-ins</h3>
            <p className="text-small text-fg-secondary">Every attempt to sign in to the console — who, from where, and whether it worked. Kept for 180 days.</p>
          </div>
          <SignInTable path="/platform/security/sign-ins" showWho limit={100} />
        </div>
      )}
    </div>
  );
}

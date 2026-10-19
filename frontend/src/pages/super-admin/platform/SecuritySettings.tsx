/** Super Admin › Settings › Security — require two-factor sign-in for every member of the platform team. */
import { useState } from 'react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { Spinner, StateBlock } from '../../../shared-components/primitives/ui';

export function SecuritySettings() {
  const { can, me, refetch } = usePlatformMe();
  const s = useQuery<{ requireTwoFactor: boolean }>('/platform/settings/security');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (s.loading && !s.data) return <StateBlock><Spinner /></StateBlock>;
  if (s.error || !s.data) return <StateBlock>{s.error ?? 'Could not load the security settings'}</StateBlock>;
  const toggle = async (on: boolean) => {
    setError(null); setBusy(true);
    try { await api.put('/platform/settings/security', { requireTwoFactor: on }); s.refetch(); refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-3">
        <h3 className="text-h3 font-medium text-fg">Two-factor sign-in</h3>
        <label className="flex items-start gap-3 text-small text-fg">
          <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={!can('settings', 'full') || busy} checked={s.data.requireTwoFactor} onChange={(e) => void toggle(e.target.checked)} />
          <span>Require it for every member of the platform team. Members without it can only set it up until they do; nobody can turn theirs off.</span>
        </label>
        {!me?.twoFactor?.enabled && <p className="text-tiny text-fg-muted">Turn it on for your own account first (Team › Your account).</p>}
        {error && <p className="text-small text-danger-text">{error}</p>}
      </div>
    </div>
  );
}

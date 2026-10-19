/**
 * Super Admin › Activity — the platform audit: what each Super Admin did (networks, plans, invoices, the
 * team, support sessions and every change made in one), and what billing did on its own (trials ending,
 * renewals, past-due flags, suspensions). Newest first, 100 at a time; search an action, a network or a
 * Super Admin's email.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { withQueryParams } from '../../lib/useApi';
import { useDebounced } from '../admin/pagedList';
import { activityLabel } from '../../lib/platformActivity';
import { PageHeader, Table, Spinner, StateBlock, Segmented, type Column } from '../../shared-components/primitives/ui';

interface ActivityRow {
  id: string; created_at: string; action: string; entity_type: string | null; entity_id: string | null;
  network_id: string | null; network_name: string | null; actor_type: string; admin_email: string | null; in_support_session: boolean;
}
const SCOPES = [{ value: 'all', label: 'All' }, { value: 'admins', label: 'Super Admins' }, { value: 'billing', label: 'Billing (automatic)' }];
const PAGE = 100;

export default function Activity() {
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 300);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const batch = await api.get<ActivityRow[]>(withQueryParams('/platform/activity', { scope, q: search || undefined, limit: PAGE, offset }));
      setRows((r) => (offset === 0 ? batch : [...r, ...batch]));
      setTotal((batch as { pagination?: { total?: number } }).pagination?.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the activity');
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(0); }, [scope, search]);

  const columns: Column<ActivityRow>[] = [
    { header: 'When', cell: (a) => <span className="whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</span> },
    { header: 'Who', cell: (a) => (a.actor_type === 'system' ? <span className="text-fg-secondary">Billing (automatic)</span> : a.admin_email ?? '—') },
    {
      header: 'What', cell: (a) => (
        <span>
          {activityLabel(a.action)}
          {a.in_support_session && <span className="ml-2 text-tiny text-fg-muted">in a support session</span>}
          <span className="ml-2 font-mono text-tiny text-fg-muted">{a.action}</span>
        </span>
      ),
    },
    { header: 'Network', cell: (a) => (a.network_id && a.network_name ? <Link to={`/admin/networks/${a.network_id}`} className="hover:underline">{a.network_name}</Link> : <span className="text-fg-muted">—</span>) },
  ];

  return (
    <>
      <PageHeader title="Activity" subtitle="What Super Admins did — and what billing did on its own." />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented options={SCOPES} value={scope} onChange={setScope} className="sm:max-w-md" />
        <input className="input sm:max-w-xs" placeholder="Search action, network or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activity" />
      </div>
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {loading && rows.length === 0 ? <StateBlock><Spinner /></StateBlock>
        : rows.length === 0 ? <StateBlock>{search || scope !== 'all' ? 'Nothing matches.' : 'No activity yet.'}</StateBlock>
        : <>
          <Table columns={columns} rows={rows} rowKey={(a) => a.id} />
          <div className="mt-3 flex items-center justify-between text-small text-fg-secondary">
            <span>{rows.length.toLocaleString()} of {total.toLocaleString()}</span>
            {rows.length < total && <button className="btn-ghost" disabled={loading} onClick={() => void load(rows.length)}>{loading ? 'Loading…' : 'Load more'}</button>}
          </div>
        </>}
    </>
  );
}

import { useState } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, StatCard, Spinner, StateBlock } from '../../components/ui';
import type { NetworkRow } from '../../types';

interface UsageResponse {
  networkId: string;
  windowDays: number;
  metrics: { metric: string; total: string }[];
}

const METRICS = ['clicks', 'conversions', 'api_calls', 'storage'];

export default function Usage() {
  const networks = useQuery<NetworkRow[]>('/platform/networks');
  const [networkId, setNetworkId] = useState('');
  const selected = networkId || networks.data?.[0]?.id || '';
  const usage = useQuery<UsageResponse>(selected ? `/platform/networks/${selected}/usage` : '/platform/networks');

  const totals = new Map((usage.data?.metrics ?? []).map((m) => [m.metric, m.total]));

  return (
    <>
      <PageHeader title="Usage" subtitle="Per-network metered usage (last 30 days). Metering begins with the click path (Phase 2)."
        action={
          <select className="input max-w-xs" value={selected} onChange={(e) => setNetworkId(e.target.value)}>
            {(networks.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        } />
      {networks.loading ? <StateBlock><Spinner /></StateBlock>
        : !selected ? <StateBlock>No networks.</StateBlock>
        : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {METRICS.map((m) => (
              <StatCard key={m} label={m.replace('_', ' ')} value={totals.get(m) ?? '0'} hint="last 30 days" />
            ))}
          </div>
        )}
    </>
  );
}

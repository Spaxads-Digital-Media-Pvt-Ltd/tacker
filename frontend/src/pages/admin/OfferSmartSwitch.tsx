import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Badge, Spinner, StateBlock, Table, type Column } from '../../components/ui';
import { CollectionTab, type FieldDef } from '../../components/CollectionTab';
import type { Advertiser, Offer, Publisher } from '../../types';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const count = (v: unknown) => <span className="tabular-nums">{Array.isArray(v) ? v.length : 0}</span>;

const TABS = ['Rules', 'History'] as const;

function Note({ children }: { children: ReactNode }) {
  return <p className="mb-4 rounded-card border border-border bg-page px-3 py-2 text-[11px] text-fg-muted">{children}</p>;
}

const ruleColumns: Column<Row>[] = [
  col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
  col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
  col('Actionable Variables', (r) => (r.actionableVariables ? String(r.actionableVariables) : '—')),
  col('Action', (r) => <Badge value={String(r.action)} />),
  col('Action Delay', (r) => (r.actionDelay ? String(r.actionDelay) : '—')),
  col('Variable', (r) => (r.variable ? String(r.variable) : '—')),
  col('Offers', (r) => count(r.offerIds)),
  col('Advertisers', (r) => count(r.advertiserIds)),
  col('Partners', (r) => count(r.partnerIds)),
  col('Status', (r) => <Badge value={String(r.status)} />),
  col('Created', (r) => fmt(r.createdAt)),
  col('Modified', (r) => fmt(r.updatedAt)),
];

const entOpts = <T extends { id: string; name: string; ref?: number }>(rows: T[] | null | undefined) =>
  (rows ?? []).map((r) => ({ value: r.id, label: r.ref != null ? `${r.name} (${r.ref})` : r.name }));

function useRuleFields(): FieldDef[] {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  return useMemo<FieldDef[]>(() => [
    { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Auto-pause on high fraud rate' },
    { key: 'action', label: 'Action', type: 'select', options: ['notify', 'block'], default: 'notify' },
    { key: 'actionDelay', label: 'Action Delay', type: 'duration' },
    { key: 'variable', label: 'Variable', placeholder: 'e.g. conversion_rate' },
    { key: 'actionableVariables', label: 'Actionable Variables', placeholder: 'e.g. epc, cvr' },
    { key: 'offerIds', label: 'Offers', type: 'multiselect', options: entOpts(offers), placeholder: 'Type to search offers…' },
    { key: 'advertiserIds', label: 'Advertisers', type: 'multiselect', options: entOpts(advertisers), placeholder: 'Type to search advertisers…' },
    { key: 'partnerIds', label: 'Partners', type: 'multiselect', options: entOpts(publishers), placeholder: 'Type to search partners…' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
  ], [offers, advertisers, publishers]);
}

const historyColumns: Column<Row>[] = [
  col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
  col('Rule', (r) => <span className="font-medium text-fg">{String(r.ruleName)}</span>),
  col('Change', (r) => String(r.change)),
  col('Employee', (r) => (r.employee ? String(r.employee) : 'System')),
  col('Date/Time', (r) => fmt(r.createdAt)),
];

function HistoryPanel() {
  const { data, loading, error } = useQuery<Row[]>('/api/smartswitch/history');
  return (
    <>
      <Note>This is a real audit trail of rule <em>changes</em> (create / update / delete) — not of rule executions. SmartSwitch does not run rules yet.</Note>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
        : <Table columns={historyColumns} rows={data} rowKey={(r) => r.id} />}
    </>
  );
}

/** Offers › SmartSwitch — "automatic optimization / fraud-protection" rules. IMPORTANT: nothing
 * evaluates these rules today (no worker / cron / tracking hook reads smartswitch_rules), so no
 * rule fires. CRUD + the auto-logged History audit trail are the only real parts — see
 * api-backend smartswitch/routes.ts. */
export default function OfferSmartSwitch() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Rules');
  const ruleFields = useRuleFields();
  return (
    <>
      <PageHeader title="Manage Rules" subtitle="Offers › SmartSwitch › Manage" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      {tab === 'Rules' ? (
        <>
          <Note>
            Rules are stored as a reference catalog — SmartSwitch does not auto-optimize, auto-pause or
            send notifications yet, so no rule here fires. The live automatic protection in this build is
            the async fraud scan (Reports → Fraud / Alerts), each offer’s own caps (Offer → Tracking &amp;
            Controls) and Traffic Controls / Traffic Blocking (enforced at the click). The History tab is
            a genuine audit trail of rule changes.
          </Note>
          <CollectionTab
            basePath="/api/smartswitch/rules"
            addLabel="New Rule"
            emptyText="No SmartSwitch rules yet."
            editable
            searchKeys={['name', 'variable', 'actionableVariables', 'action', 'actionDelay']}
            searchPlaceholder="Search by name…"
            fields={ruleFields}
            columns={ruleColumns}
          />
        </>
      ) : (
        <HistoryPanel />
      )}
    </>
  );
}

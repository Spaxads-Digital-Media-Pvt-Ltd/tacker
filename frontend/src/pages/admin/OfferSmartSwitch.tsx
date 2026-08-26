import { useState, type ReactNode } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Badge, Spinner, StateBlock, Table, type Column } from '../../components/ui';
import { CollectionTab, type FieldDef } from '../../components/CollectionTab';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

const TABS = ['Rules', 'History'] as const;

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

const ruleFields: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Auto-pause on high fraud rate' },
  { key: 'action', label: 'Action', type: 'select', options: ['notify', 'block'], default: 'notify' },
  { key: 'actionDelay', label: 'Action Delay', placeholder: 'e.g. 15 minutes' },
  { key: 'variable', label: 'Variable', placeholder: 'e.g. conversion_rate' },
  { key: 'actionableVariables', label: 'Actionable Variables', placeholder: 'e.g. epc, cvr' },
  { key: 'offerIds', label: 'Offer IDs (comma separated)', type: 'tags' },
  { key: 'advertiserIds', label: 'Advertiser IDs (comma separated)', type: 'tags' },
  { key: 'partnerIds', label: 'Partner IDs (comma separated)', type: 'tags' },
  { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
];

const historyColumns: Column<Row>[] = [
  col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
  col('Rule', (r) => <span className="font-medium text-fg">{String(r.ruleName)}</span>),
  col('Change', (r) => String(r.change)),
  col('Employee', (r) => (r.employee ? String(r.employee) : 'System')),
  col('Date/Time', (r) => fmt(r.createdAt)),
];

function HistoryPanel() {
  const { data, loading, error } = useQuery<Row[]>('/api/smartswitch/history');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  if (!data || data.length === 0) return <StateBlock>No changes recorded yet.</StateBlock>;
  return <Table columns={historyColumns} rows={data} rowKey={(r) => r.id} />;
}

/** Offers › SmartSwitch — automatic optimization/fraud-protection rules. Every rule mutation is
 * auto-logged server-side to smartswitch_history, so History is a genuine audit trail. */
export default function OfferSmartSwitch() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Rules');
  return (
    <>
      <PageHeader title="Manage Rules" subtitle="Offers › SmartSwitch › Manage" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      {tab === 'Rules' ? (
        <CollectionTab
          basePath="/api/smartswitch/rules"
          addLabel="New Rule"
          emptyText="No SmartSwitch rules yet."
          editable
          fields={ruleFields}
          columns={ruleColumns}
        />
      ) : (
        <HistoryPanel />
      )}
    </>
  );
}

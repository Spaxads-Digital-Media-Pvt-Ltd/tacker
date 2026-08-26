import type { ReactNode } from 'react';
import { useQuery } from '../../../lib/useApi';
import { Accordion } from '../../../components/Accordion';
import { CollectionTab, type FieldDef } from '../../../components/CollectionTab';
import { StateBlock, Spinner, Table, type Column } from '../../../components/ui';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

type PubOptions = { value: string; label: string }[];

export function ForwardingRulesTab({ base }: { base: string }) {
  return (
    <CollectionTab
      basePath={`${base}/forwarding-rules`}
      addLabel="Forwarding Rule"
      emptyText="No forwarding rules."
      editable
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'partnerIds', label: 'Partner IDs (comma separated)', type: 'tags' },
        { key: 'offerUrls', label: 'Offer URLs (comma separated)', type: 'tags' },
        { key: 'destination', label: 'Destination', type: 'url' },
        { key: 'countries', label: 'Countries (comma separated ISO-2)', type: 'tags' },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
      ] as FieldDef[]}
      columns={[
        col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
        col('Partners', (r) => count(r.partnerIds)),
        col('Offer URLs', (r) => count(r.offerUrls)),
        col('Destination', (r) => (r.destination ? String(r.destination) : '—')),
        col('Countries', (r) => (Array.isArray(r.countries) && r.countries.length ? r.countries.join(', ') : '—')),
        col('Created', (r) => fmt(r.createdAt)),
        col('Modified', (r) => fmt(r.updatedAt)),
      ]}
    />
  );
}

export function ScheduledActionsTab({ base }: { base: string }) {
  return (
    <CollectionTab
      basePath={`${base}/scheduled-actions`}
      addLabel="Action"
      emptyText="No scheduled actions."
      editable
      fields={[
        { key: 'actionType', label: 'Type', type: 'select', options: ['activate', 'pause', 'archive', 'cap_change'], default: 'pause' },
        { key: 'partnerIds', label: 'Partner IDs (comma separated)', type: 'tags' },
        { key: 'event', label: 'Event' },
        { key: 'scheduledTime', label: 'Scheduled Time (ISO 8601)', placeholder: '2026-09-01T00:00:00Z' },
        { key: 'internalNotes', label: 'Internal Notes', type: 'textarea' },
        { key: 'status', label: 'Status', type: 'select', options: ['pending', 'executed', 'cancelled'], default: 'pending' },
      ] as FieldDef[]}
      columns={[
        col('Type', (r) => <span className="font-medium capitalize text-fg">{String(r.actionType).replace('_', ' ')}</span>),
        col('Partners', (r) => count(r.partnerIds)),
        col('Event', (r) => (r.event ? String(r.event) : '—')),
        col('Scheduled Time', (r) => fmt(r.scheduledTime)),
        col('Internal Notes', (r) => (r.internalNotes ? String(r.internalNotes) : '—')),
        col('Created By', (r) => (r.createdBy ? String(r.createdBy) : 'System')),
        col('Created', (r) => fmt(r.createdAt)),
        col('Modified', (r) => fmt(r.updatedAt)),
      ]}
    />
  );
}

function PostbackLevel({ base, level, pubOptions }: { base: string; level: string; pubOptions: PubOptions }) {
  return (
    <CollectionTab
      basePath={`${base}/postbacks`}
      listPath={`${base}/postbacks`}
      addLabel="Add"
      emptyText={`No ${level} postbacks.`}
      editable
      fields={[
        { key: 'publisherId', label: 'Partner', type: 'select', options: pubOptions, required: true },
        { key: 'level', label: '', type: 'hidden', default: level },
        { key: 'url', label: 'Postback URL', type: 'url', required: true },
        { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'], default: 'GET' },
        { key: 'event', label: 'Event Name', placeholder: level === 'event' ? 'e.g. trial_started' : undefined },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'disabled'], default: 'active' },
      ] as FieldDef[]}
      columns={[
        col('Partner', (r) => pubOptions.find((p) => p.value === r.publisherId)?.label ?? String(r.publisherId ?? '—')),
        col('Method', (r) => String(r.method)),
        col('Postback URL', (r) => <span className="font-mono text-tiny">{String(r.url)}</span>),
        ...(level === 'event' ? [col('Event Name', (r: Row) => (r.event ? String(r.event) : '—'))] : []),
        col('Status', (r) => String(r.status)),
        col('Created', (r) => fmt(r.createdAt)),
      ]}
    />
  );
}

export function PostbacksTab({ base, pubOptions }: { base: string; pubOptions: PubOptions }) {
  return (
    <div className="space-y-4">
      <Accordion title="Conversion" count={0}><PostbackLevel base={base} level="conversion" pubOptions={pubOptions} /></Accordion>
      <Accordion title="Event" count={0}><PostbackLevel base={base} level="event" pubOptions={pubOptions} /></Accordion>
      <Accordion title="CPC" count={0}><PostbackLevel base={base} level="cpc" pubOptions={pubOptions} /></Accordion>
    </div>
  );
}

const historyColumns: Column<Row>[] = [
  col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{String(r.id).slice(0, 8)}</span>),
  col('Operation Time', (r) => fmt(r.operationTime)),
  col('Service', (r) => String(r.service)),
  col('Changes', (r) => String(r.changes)),
  col('Employee', (r) => (r.employee ? String(r.employee) : 'System')),
  col('Method', (r) => String(r.method)),
  col('Portal', (r) => String(r.portal)),
  col('User IP', (r) => (r.userIp ? String(r.userIp) : '—')),
  col('User Agent', (r) => (r.userAgent ? String(r.userAgent) : '—')),
];

export function HistoryTab({ base }: { base: string }) {
  const { data, loading, error } = useQuery<Row[]>(`${base}/history`);
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  if (!data || data.length === 0) return <StateBlock>No changes recorded yet.</StateBlock>;
  return <Table columns={historyColumns} rows={data} rowKey={(r) => r.id} />;
}

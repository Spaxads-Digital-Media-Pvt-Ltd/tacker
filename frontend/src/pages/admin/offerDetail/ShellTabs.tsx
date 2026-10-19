import type { ReactNode } from 'react';
import { useQuery } from '../../../lib/useApi';
import { createdByLabel } from '../../../lib/createdBy';
import { Accordion } from '../../../shared-components/panels/Accordion';
import { CollectionTab, type FieldDef } from '../../../shared-components/panels/CollectionTab';
import { StateBlock, Spinner, Table, type Column } from '../../../shared-components/primitives/ui';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

type PubOptions = { value: string; label: string }[];

export function ForwardingRulesTab({ base, pubOptions = [] }: { base: string; pubOptions?: PubOptions }) {
  return (
    <CollectionTab
      basePath={`${base}/forwarding-rules`}
      addLabel="Forwarding Rule"
      emptyText="No forwarding rules."
      editable
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'partnerIds', label: 'Partners', type: 'multiselect', options: pubOptions, placeholder: 'Type to search partners…' },
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

const CAP_OPTIONS = [
  { value: 'daily_click', label: 'Daily clicks' }, { value: 'daily_conversion', label: 'Daily conversions' }, { value: 'total_conversion', label: 'Total conversions' },
];
const capLabel = (v: unknown) => CAP_OPTIONS.find((o) => o.value === v)?.label ?? String(v ?? '—');
const isCapChange = (f: Record<string, string | boolean>) => f.actionType === 'cap_change';

export function ScheduledActionsTab({ base, pubOptions = [] }: { base: string; pubOptions?: PubOptions }) {
  return (
    <>
    <p className="mb-3 rounded-card border border-border bg-page px-3 py-2 text-[11px] text-fg-muted">Pending actions run automatically at their scheduled time (checked every minute). Activate / pause can target selected partners; archive and cap change apply to the whole offer. A cap change with an empty value removes that cap.</p>
    <CollectionTab
      basePath={`${base}/scheduled-actions`}
      addLabel="Action"
      emptyText="No scheduled actions."
      editable
      // An empty cap value on a cap change means "remove the cap" (null), not "leave it out".
      prepareBody={(body, form) => (isCapChange(form) && body['capValue'] === undefined ? { ...body, capValue: null } : body)}
      fields={[
        { key: 'actionType', label: 'Type', type: 'select', options: ['activate', 'pause', 'archive', 'cap_change'], default: 'pause' },
        { key: 'capType', label: 'Cap to change', type: 'select', options: CAP_OPTIONS, required: true, default: 'daily_click', showIf: isCapChange },
        { key: 'capValue', label: 'New cap value (empty = remove the cap)', type: 'number', placeholder: 'e.g. 500', showIf: isCapChange },
        { key: 'partnerIds', label: 'Partners', type: 'multiselect', options: pubOptions, placeholder: 'Type to search partners…', showIf: (f) => f.actionType === 'activate' || f.actionType === 'pause' },
        { key: 'event', label: 'Event' },
        { key: 'scheduledTime', label: 'Scheduled Time (ISO 8601)', placeholder: '2026-09-01T00:00:00Z' },
        { key: 'internalNotes', label: 'Internal Notes', type: 'textarea' },
        { key: 'status', label: 'Status', type: 'select', options: ['pending', 'executed', 'cancelled'], default: 'pending' },
      ] as FieldDef[]}
      columns={[
        col('Type', (r) => <span className="font-medium capitalize text-fg">{String(r.actionType).replace('_', ' ')}</span>),
        col('Cap', (r) => (r.actionType === 'cap_change' ? `${capLabel(r.capType)} → ${r.capValue ?? 'no cap'}` : '—')),
        col('Partners', (r) => count(r.partnerIds)),
        col('Event', (r) => (r.event ? String(r.event) : '—')),
        col('Scheduled Time', (r) => fmt(r.scheduledTime)),
        col('Status', (r) => {
          const err = (r.result as { error?: string } | null | undefined)?.error;
          return <span className={r.status === 'failed' ? 'text-danger-text' : undefined} title={err ?? undefined}>{String(r.status ?? '—')}{err ? ` — ${err}` : ''}</span>;
        }),
        col('Internal Notes', (r) => (r.internalNotes ? String(r.internalNotes) : '—')),
        col('Created By', (r) => createdByLabel(r.createdBy, r.createdByName)),
        col('Created', (r) => fmt(r.createdAt)),
        col('Modified', (r) => fmt(r.updatedAt)),
      ]}
    />
    </>
  );
}

function PostbackLevel({ base, level, pubOptions }: { base: string; level: string; pubOptions: PubOptions }) {
  return (
    <CollectionTab
      basePath={`${base}/postbacks`}
      listPath={`${base}/postbacks?level=${level}`}
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
  const all = useQuery<Row[]>(`${base}/postbacks`);
  const count = (level: string) => all.data?.filter((r) => r.level === level).length;
  return (
    <div className="space-y-4">
      <p className="text-small text-fg-secondary">Conversion and Event postbacks fire to the partner when a conversion is approved; CPC postbacks are stored for click-based setups and are not fired on conversions.</p>
      <Accordion title="Conversion" count={count('conversion')}><PostbackLevel base={base} level="conversion" pubOptions={pubOptions} /></Accordion>
      <Accordion title="Event" count={count('event')}><PostbackLevel base={base} level="event" pubOptions={pubOptions} /></Accordion>
      <Accordion title="CPC" count={count('cpc')}><PostbackLevel base={base} level="cpc" pubOptions={pubOptions} /></Accordion>
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

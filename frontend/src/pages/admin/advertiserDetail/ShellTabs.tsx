import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyShellTable } from '../../../shared-components/primitives/EmptyShellTable';
import { Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { CollectionTab, type FieldDef } from '../../../shared-components/panels/CollectionTab';
import { useQuery } from '../../../lib/useApi';
import type { Offer } from '../../../types';

const ApiKeys = lazy(() => import('../../portal/ApiKeys'));

type EventRow = { id: string; [k: string]: unknown };
const evCol = (header: string, cell: (r: EventRow) => ReactNode): Column<EventRow> => ({ header, cell });
const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : '—');

/**
 * An advertiser's events are the goals on its offers (the same rows as Offer Details → Goals, and
 * what a postback's `event` param matches). "Associated to" is the offer the event belongs to.
 */
export function EventsTab({ advertiserId }: { advertiserId: string }) {
  const { data: offers, loading, error } = useQuery<Offer[]>('/api/offers');
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  const own = (offers ?? []).filter((o) => o.advertiserId === advertiserId);
  const offerOptions = own.map((o) => ({ value: o.id, label: o.ref != null ? `#${o.ref} ${o.name}` : o.name }));

  return (
    <div className="space-y-3">
      <p className="text-small text-fg-secondary">
        Events are the conversion events (goals) of this advertiser's offers. A postback whose <span className="font-mono">event</span> matches
        an event name is priced with that event's payout and revenue; the default event applies when no event is sent.
        The same events appear under Offer Details → Goals.
      </p>
      {own.length === 0 && (
        <p className="rounded-[var(--radius)] bg-warning-bg px-3 py-2 text-small text-warning-text">
          This advertiser has no offers yet. Every event belongs to an offer, so create an offer for this advertiser first.
        </p>
      )}
      <CollectionTab
        basePath={`/api/advertisers/${advertiserId}/events`}
        addLabel="+ Event"
        editable
        emptyText="No events yet — conversions on this advertiser's offers use each offer's own payout and revenue."
        searchKeys={['name', 'eventName', 'offerName']}
        searchPlaceholder="Search events…"
        fields={[
          { key: 'offerId', label: 'Associated to (offer)', type: 'select', required: true, options: offerOptions, default: offerOptions[0]?.value ?? '' },
          { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Purchase' },
          { key: 'eventName', label: 'Event name (matches the postback event)', placeholder: 'e.g. purchase' },
          { key: 'payoutModel', label: 'Payout model', type: 'select', options: ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'], default: 'CPA' },
          { key: 'payout', label: 'Payout', type: 'money', default: '0' },
          { key: 'revenue', label: 'Revenue', type: 'money', default: '0' },
          { key: 'dailyConversionCap', label: 'Daily conversion cap', type: 'number', placeholder: 'Unlimited' },
          { key: 'totalConversionCap', label: 'Total conversion cap', type: 'number', placeholder: 'Unlimited' },
          { key: 'isDefault', label: 'Default event for its offer', type: 'checkbox' },
          { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
        ] as FieldDef[]}
        columns={[
          evCol('Name', (r) => String(r.name)),
          evCol('Event', (r) => (r.eventName ? <span className="font-mono text-tiny">{String(r.eventName)}</span> : '—')),
          evCol('Associated to', (r) => (
            <Link to={`/app/offers/${String(r.offerId)}?tab=Goals`} className="text-accent-text hover:underline">
              {r.offerRef != null ? `#${String(r.offerRef)} ` : ''}{String(r.offerName)}
            </Link>
          )),
          evCol('Payout', (r) => `${String(r.currency)} ${String(r.payout)}`),
          evCol('Revenue', (r) => `${String(r.currency)} ${String(r.revenue)}`),
          evCol('Status', (r) => <>{String(r.status)}{r.isDefault ? ' · default' : ''}</>),
          evCol('Created', (r) => fmtDate(r.createdAt)),
          evCol('Modified', (r) => fmtDate(r.updatedAt)),
        ]}
      />
    </div>
  );
}

export function UsersTab() {
  return <EmptyShellTable addLabel="User" columns={['ID', 'Name', 'Title', 'Work Phone', 'Cell Phone', 'Email', 'Created', 'Modified']} />;
}

/** Real keys for this advertiser (audience 'advertiser') — same keys the advertiser sees in their portal. */
export function ApiKeysTab({ advertiserId }: { advertiserId: string }) {
  return (
    <Suspense fallback={<StateBlock><Spinner /></StateBlock>}>
      <ApiKeys
        basePath={`/api/advertisers/${advertiserId}/keys`}
        subtitle="Keys for this advertiser's Public API access (advertiser endpoints only, scoped to its own data). The full key is shown once at creation."
      />
    </Suspense>
  );
}

/** Shared edit form for the two whitelist kinds — matches the reference's dedicated "Edit" screen
 * (one textarea, one value per line). No backend field for either, so Save is inert. */
function WhitelistEditForm({ label, count, onCancel }: { label: string; count: number; onCancel: () => void }) {
  return (
    <div className="max-w-2xl mx-auto card space-y-2">
      <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
      <div className="flex items-center justify-between">
        <label className="label">{label}</label>
        <span className="text-tiny text-fg-muted">{count} value(s) entered</span>
      </div>
      <textarea title="Not available yet" className="input min-h-[220px] font-mono text-tiny" placeholder="Enter one value per line" />
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button title="Not available yet" className="btn-primary" onClick={onCancel}>Save</button>
      </div>
    </div>
  );
}

export function ApiIpsTab() {
  const [editing, setEditing] = useState(false);
  if (editing) return <WhitelistEditForm label="Whitelist IPs" count={0} onCancel={() => setEditing(false)} />;
  return (
    <>
      <p className="mb-3 text-tiny italic text-fg-muted">All IPs are allowed to call the API.</p>
      <EmptyShellTable search={false} columns={['IP', 'Created']} left={<button className="btn-primary" onClick={() => setEditing(true)}>Edit</button>} />
    </>
  );
}

export function WhitelistTab() {
  const [sub, setSub] = useState<'Domains' | 'IPs'>('Domains');
  const [editing, setEditing] = useState(false);
  if (editing) return <WhitelistEditForm label={`Whitelist ${sub}`} count={0} onCancel={() => setEditing(false)} />;
  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-border">
        {(['Domains', 'IPs'] as const).map((t) => (
          <button key={t} onClick={() => setSub(t)}
            className={`-mb-px whitespace-nowrap px-3.5 py-2 text-small font-medium transition-colors ${sub === t ? 'border-b-2 border-accent text-accent-text' : 'border-b-2 border-transparent text-fg-secondary hover:text-fg'}`}>
            {t}
          </button>
        ))}
      </div>
      <p className="mb-3 text-tiny italic text-fg-muted">All {sub.toLowerCase()} are allowed.</p>
      <EmptyShellTable search={false} columns={[sub === 'Domains' ? 'Domain' : 'IP', 'Created']} left={<button className="btn-primary" onClick={() => setEditing(true)}>Edit</button>} />
    </>
  );
}

export function DocumentsTab() {
  return <EmptyShellTable addLabel="Document" columns={['ID', 'Name', 'Description', 'File', 'Created', 'Modified']} />;
}

export function OptizmoTab() {
  return (
    <div className="card">
      <p className="text-small italic text-fg-muted">Not configured for this network.</p>
    </div>
  );
}

export function ProductFeedsTab() {
  return <EmptyShellTable addLabel="Product Feed" columns={['Name', 'Effective from', 'Effective until', 'Partners', 'Offers', 'Created', 'Modified']} />;
}

export function DealsTab() {
  return <EmptyShellTable addLabel="Deal" columns={['Name', 'Brand Name', 'Deal Type', 'Categories', 'Coupon Code', 'Threshold Amount', 'Created', 'Modified']} />;
}

export function HistoryTab() {
  return <EmptyShellTable columns={['ID', 'Operation Time', 'Service', 'Changes', 'Employee', 'Method', 'Portal', 'User IP', 'User Agent']} />;
}

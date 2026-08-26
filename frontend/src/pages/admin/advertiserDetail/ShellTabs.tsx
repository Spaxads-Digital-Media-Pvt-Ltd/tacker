import { useState } from 'react';
import { EmptyShellTable } from '../../../components/EmptyShellTable';

export function EventsTab() {
  return <EmptyShellTable addLabel="Event" columns={['ID', 'Name', 'Associated to', 'Created', 'Modified']} />;
}

export function UsersTab() {
  return <EmptyShellTable addLabel="User" columns={['ID', 'Name', 'Title', 'Work Phone', 'Cell Phone', 'Email', 'Created', 'Modified']} />;
}

export function ApiKeysTab() {
  return <EmptyShellTable addLabel="API key" columns={['Key', 'Created By']} />;
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

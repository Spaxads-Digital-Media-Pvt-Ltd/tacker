/**
 * Custom-field definitions management for an entity type (Affiliates/Advertisers sub-nav "Custom
 * Fields"). Define and delete network-level custom fields; values are set per-entity on their detail
 * screens. Prop-driven so one component serves both routes.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Badge, Field, Modal, Spinner, StateBlock, type Column } from '../../components/ui';

interface Def { id: string; key: string; label: string; fieldType: string; options: string[]; required: boolean }

export function CustomFieldsManage({ entityType }: { entityType: 'publisher' | 'advertiser' | 'offer' }) {
  const { data, loading, error, refetch } = useQuery<Def[]>(`/api/custom-fields?entity=${entityType}`);
  const [open, setOpen] = useState(false);
  const del = useMutation((id: string) => api.del(`/api/custom-fields/${id}`));
  const noun = entityType === 'publisher' ? 'affiliate' : entityType;

  const cols: Column<Def>[] = [
    { header: 'Label', cell: (d) => <span className="font-medium">{d.label}</span> },
    { header: 'Key', cell: (d) => <span className="font-mono text-tiny text-fg-muted">{d.key}</span> },
    { header: 'Type', cell: (d) => d.fieldType },
    { header: 'Required', cell: (d) => (d.required ? <Badge value="active" /> : '—') },
    { header: '', className: 'text-right', cell: (d) => <button className="text-tiny font-medium text-danger-text hover:underline" onClick={async () => { if (confirm(`Delete "${d.label}"?`)) { await del.run(d.id); refetch(); } }}>Delete</button> },
  ];

  return (
    <>
      <PageHeader title="Custom Fields" subtitle={`Create and manage custom fields for ${noun}s.`}
        action={<button className="btn-primary" onClick={() => setOpen(true)}>+ Add New</button>} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No custom fields found. Click “Add New”.</StateBlock>
        : <Table columns={cols} rows={data} rowKey={(d) => d.id} />}
      {open && <DefineModal entityType={entityType} onClose={() => setOpen(false)} onDone={() => { setOpen(false); refetch(); }} />}
    </>
  );
}

function DefineModal({ entityType, onClose, onDone }: { entityType: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ key: '', label: '', fieldType: 'text', options: '', required: false });
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/custom-fields', body));
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({ entityType, key: form.key, label: form.label, fieldType: form.fieldType, required: form.required, options: form.fieldType === 'select' ? form.options.split(',').map((s) => s.trim()).filter(Boolean) : [] });
    if (res) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Define custom field">
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Key (letters/numbers/underscore)"><input className="input" required value={form.key} onChange={(e) => set('key', e.target.value)} placeholder="skype_id" /></Field>
        <Field label="Label"><input className="input" required value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Skype ID" /></Field>
        <Field label="Type"><select className="input" value={form.fieldType} onChange={(e) => set('fieldType', e.target.value)}>{['text', 'number', 'boolean', 'select'].map((t) => <option key={t}>{t}</option>)}</select></Field>
        {form.fieldType === 'select' && <Field label="Options (comma-separated)"><input className="input" value={form.options} onChange={(e) => set('options', e.target.value)} placeholder="tier1, tier2" /></Field>}
        <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" className="chk" checked={form.required} onChange={(e) => set('required', e.target.checked)} /> Required</label>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Define'}</button></div>
      </form>
    </Modal>
  );
}

/**
 * Custom-fields panel — lets an admin (a) define network-level custom fields for an entity type
 * and (b) set this entity's values for them. Reused by publisher & advertiser detail screens.
 *   - defs come from  /api/custom-fields?entity=<entityType>
 *   - values are saved by PATCHing the entity with { customFields: {...} }
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useQuery, useMutation } from '../lib/useApi';
import { Field, Spinner, StateBlock, Modal } from './ui';

interface FieldDef {
  id: string; entityType: string; key: string; label: string;
  fieldType: 'text' | 'number' | 'boolean' | 'select'; options: string[]; required: boolean;
}

export function CustomFieldsPanel({
  entityType, entityPath, values,
}: {
  entityType: 'publisher' | 'advertiser' | 'offer';
  entityPath: string;               // e.g. /api/publishers/:id — patched with { customFields }
  values: Record<string, unknown>;  // current values from the entity
}) {
  const { data: defs, loading, error, refetch } = useQuery<FieldDef[]>(`/api/custom-fields?entity=${entityType}`);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const save = useMutation((body: Record<string, unknown>) => api.patch(entityPath, body));

  // Seed the form from current values whenever defs/values change.
  useEffect(() => {
    if (!defs) return;
    const next: Record<string, string | boolean> = {};
    for (const d of defs) {
      const v = values[d.key];
      next[d.key] = d.fieldType === 'boolean' ? Boolean(v) : v == null ? '' : String(v);
    }
    setForm(next);
  }, [defs, values]);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const customFields: Record<string, unknown> = {};
    for (const d of defs ?? []) {
      const v = form[d.key];
      customFields[d.key] = d.fieldType === 'number' ? (v === '' ? null : Number(v)) : v;
    }
    await save.run({ customFields });
  };

  const empty = useMemo(() => !defs || defs.length === 0, [defs]);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex justify-end">
        <button className="btn-ghost" onClick={() => setAddOpen(true)}>+ Define field</button>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : empty ? <StateBlock>No custom fields defined for {entityType}s yet. Define one to start.</StateBlock>
        : (
          <form onSubmit={submit} className="space-y-3">
            {save.error && <p className="text-sm text-danger-text">{save.error}</p>}
            {(defs ?? []).map((d) => (
              <Field key={d.id} label={`${d.label}${d.required ? ' *' : ''}`}>
                {d.fieldType === 'boolean' ? (
                  <input type="checkbox" className="chk" checked={Boolean(form[d.key])} onChange={(e) => set(d.key, e.target.checked)} />
                ) : d.fieldType === 'select' ? (
                  <select className="input" value={String(form[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value)}>
                    <option value="">—</option>
                    {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="input" type={d.fieldType === 'number' ? 'number' : 'text'} value={String(form[d.key] ?? '')} onChange={(e) => set(d.key, e.target.value)} />
                )}
              </Field>
            ))}
            <button type="submit" className="btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save values'}</button>
          </form>
        )}
      <DefineFieldModal open={addOpen} onClose={() => setAddOpen(false)} entityType={entityType} onDone={() => { setAddOpen(false); refetch(); }} />
    </div>
  );
}

function DefineFieldModal({
  open, onClose, entityType, onDone,
}: { open: boolean; onClose: () => void; entityType: string; onDone: () => void }) {
  const [form, setForm] = useState({ key: '', label: '', fieldType: 'text', options: '', required: false });
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/custom-fields', body));
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({
      entityType, key: form.key, label: form.label, fieldType: form.fieldType, required: form.required,
      options: form.fieldType === 'select' ? form.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
    });
    if (res) { setForm({ key: '', label: '', fieldType: 'text', options: '', required: false }); onDone(); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Define ${entityType} custom field`}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-sm text-danger-text">{error}</p>}
        <Field label="Key (letters, numbers, underscore)"><input className="input" required value={form.key} onChange={(e) => set('key', e.target.value)} placeholder="skype_id" /></Field>
        <Field label="Label"><input className="input" required value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Skype ID" /></Field>
        <Field label="Type">
          <select className="input" value={form.fieldType} onChange={(e) => set('fieldType', e.target.value)}>
            {['text', 'number', 'boolean', 'select'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        {form.fieldType === 'select' && (
          <Field label="Options (comma-separated)"><input className="input" value={form.options} onChange={(e) => set('options', e.target.value)} placeholder="tier1, tier2, tier3" /></Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="chk" checked={form.required} onChange={(e) => set('required', e.target.checked)} /> Required
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Define'}</button>
        </div>
      </form>
    </Modal>
  );
}

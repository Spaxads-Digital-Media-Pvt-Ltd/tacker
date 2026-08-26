/**
 * Offers › Templates › Add / Edit — matches the reference's own dedicated page (not a modal):
 * verified live at /offers/templates/add. Template Name + "Use as default", then a "Prefilled
 * Fields" list built one row at a time via "+" — each row is a bracket-connected, collapsible box
 * with a Field Type select and (once chosen) its value input, plus a trash-icon delete — the same
 * "+"-row pattern already used for Platform Configurations' IPs Blacklist editor.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { HelpIcon } from './controlCenter/shared';
import { useFieldSpecs, type Template } from '../../data/offerTemplateFields';

interface Row { id: number; key: string; value: string; open: boolean }

export default function OfferTemplateForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const specs = useFieldSpecs();
  const { data: existing } = useQuery<Template>(isEdit ? `/api/offer-templates/${id}` : null);

  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const nextId = useRef(1);
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name);
      setIsDefault(existing.isDefault);
      setRows(Object.entries(existing.fieldValues).map(([key, value]) => ({ id: nextId.current++, key, value, open: true })));
    }
  }, [existing]);

  const addRow = () => setRows((r) => [...r, { id: nextId.current++, key: '', value: '', open: true }]);
  const removeRow = (rid: number) => setRows((r) => r.filter((x) => x.id !== rid));
  const setKey = (rid: number, key: string) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, key, value: '' } : x)));
  const setValue = (rid: number, value: string) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, value } : x)));
  const toggleOpen = (rid: number) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, open: !x.open } : x)));

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/offer-templates/${id}`, body) : api.post('/api/offer-templates', body));

  const submit = async () => {
    const fieldValues: Record<string, string> = {};
    for (const r of rows) if (r.key && r.value) fieldValues[r.key] = r.value;
    const res = await run({ name, isDefault, fieldValues });
    if (res !== null) nav('/app/offers-templates');
  };

  const usedKeys = new Set(rows.map((r) => r.key).filter(Boolean));

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Template' : 'Add Template'} subtitle={`Offers › Offer Templates › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="card space-y-5">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-md flex-1"><Field label="Template Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
          <label className="flex items-center gap-1.5 pt-6 text-small font-medium text-fg">
            Use as default <HelpIcon text="This template will be pre-selected whenever a new offer is created from a template." />
            <input type="checkbox" className="chk ml-1" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-small font-semibold text-fg">Prefilled Fields</label>
          <button type="button" onClick={addRow} title="Add a field" className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Plus size={14} /></button>
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const spec = specs.find((s) => s.key === row.key);
            return (
              <div key={row.id} className="ml-3 flex items-start gap-2 border-l-2 border-border pl-4">
                <div className="w-full max-w-md rounded-card border border-border bg-page p-3">
                  <button type="button" onClick={() => toggleOpen(row.id)} className="mb-2 flex items-center gap-1 text-fg-secondary hover:text-fg">
                    {row.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {row.open && (
                    <div className="space-y-3">
                      <Field label="Field Type *">
                        <select className="input" value={row.key} onChange={(e) => setKey(row.id, e.target.value)}>
                          <option value="">Select…</option>
                          {specs.filter((s) => !usedKeys.has(s.key) || s.key === row.key).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </Field>
                      {spec && (
                        spec.type === 'select' ? (
                          <Field label="Value">
                            <select className="input" value={row.value} onChange={(e) => setValue(row.id, e.target.value)}>
                              <option value="">—</option>
                              {(spec.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </Field>
                        ) : (
                          <Field label="Value"><input className="input" value={row.value} onChange={(e) => setValue(row.id, e.target.value)} /></Field>
                        )
                      )}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => removeRow(row.id)} title="Remove"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-danger-bg hover:text-danger-text">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => nav('/app/offers-templates')}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy || !name} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
      </div>
    </>
  );
}

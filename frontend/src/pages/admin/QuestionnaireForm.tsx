/**
 * Add/Edit Questionnaire — full page matching the reference's dynamic Fields builder (drag to
 * reorder, per-field Label/Required/Tooltip/Data Field, Select-type fields get an Options list)
 * plus a "Preview Questionnaire" modal that renders the fields as a Partner would see them.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, GripVertical, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Modal, Spinner, StateBlock } from '../../components/ui';
import type { Questionnaire, QuestionnaireDataField, QuestionnaireField } from '../../types';

const DATA_FIELDS: { value: QuestionnaireDataField; label: string }[] = [
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date_input', label: 'Date Input' },
  { value: 'input', label: 'Input' },
  { value: 'numeric_input', label: 'Numeric Input' },
  { value: 'select', label: 'Select' },
  { value: 'textarea', label: 'Textarea' },
];

interface DraftField { label: string; required: boolean; tooltip: string; dataField: QuestionnaireDataField; options: string[] }
const emptyField = (): DraftField => ({ label: '', required: false, tooltip: '', dataField: 'input', options: [] });

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (v && !options.includes(v)) onChange([...options, v]);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  };
  return (
    <div>
      <label className="label mb-1 block">Options</label>
      <div className="input flex min-h-[42px] flex-wrap items-center gap-1.5 !py-1.5">
        {options.map((o) => (
          <span key={o} className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-tiny text-accent-text">
            {o}
            <button type="button" onClick={() => onChange(options.filter((x) => x !== o))}><X size={11} /></button>
          </span>
        ))}
        <input className="min-w-[100px] flex-1 border-0 bg-transparent p-0.5 text-small outline-none" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={commit} placeholder={options.length === 0 ? 'Add an option and press Enter…' : ''} />
      </div>
    </div>
  );
}

function FieldCard({
  index, field, onChange, onRemove, dragHandlers,
}: {
  index: number; field: DraftField; onChange: (f: DraftField) => void; onRemove: () => void;
  dragHandlers: { draggable: boolean; onDragStart: () => void; onDragOver: (e: React.DragEvent) => void; onDrop: () => void };
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-card border border-border" {...dragHandlers}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 text-small font-medium text-fg">
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <GripVertical size={14} className="cursor-grab text-fg-muted" />
          {index + 1}{field.label ? ` — ${field.label}` : ''}
        </button>
        <button type="button" onClick={onRemove} className="text-fg-muted hover:text-danger-text"><Trash2 size={14} /></button>
      </div>
      {!collapsed && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Label *"><input className="input" required value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })} /></Field>
            <div>
              <label className="label mb-1 block">Required</label>
              <button type="button" role="switch" aria-checked={field.required} onClick={() => onChange({ ...field, required: !field.required })}
                className={`relative inline-block h-6 w-11 rounded-full transition-colors ${field.required ? 'bg-success' : 'bg-border'}`}>
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${field.required ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
          <Field label="Tooltip"><textarea className="input min-h-[60px]" value={field.tooltip} onChange={(e) => onChange({ ...field, tooltip: e.target.value })} /></Field>
          <Field label="Data Field *">
            <select className="input" required value={field.dataField} onChange={(e) => onChange({ ...field, dataField: e.target.value as QuestionnaireDataField })}>
              {DATA_FIELDS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Field>
          {field.dataField === 'select' && <OptionsEditor options={field.options} onChange={(v) => onChange({ ...field, options: v })} />}
        </div>
      )}
    </div>
  );
}

function PreviewModal({ name, fields, onClose }: { name: string; fields: DraftField[]; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={name || 'Preview Questionnaire'}>
      <div className="space-y-4">
        {fields.length === 0 && <p className="text-small text-fg-secondary">No fields defined.</p>}
        {fields.map((f, i) => (
          <div key={i}>
            <label className="label mb-1 block">{f.label || `Field ${i + 1}`}{f.required && <span className="text-danger-text"> *</span>}</label>
            {f.tooltip && <p className="mb-1 text-tiny text-fg-secondary">{f.tooltip}</p>}
            {f.dataField === 'textarea' ? <textarea className="input" disabled />
              : f.dataField === 'select' ? (
                <select className="input" disabled>
                  <option>Select…</option>
                  {f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              )
              : f.dataField === 'checkbox' ? <input type="checkbox" className="chk" disabled />
              : <input className="input" type={f.dataField === 'date_input' ? 'date' : f.dataField === 'numeric_input' ? 'number' : 'text'} disabled />}
          </div>
        ))}
        <div className="flex justify-end border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

export default function QuestionnaireForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: existing, loading } = useQuery<Questionnaire>(isEdit ? `/api/questionnaires/${id}` : null);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/questionnaires', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/questionnaires/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [fields, setFields] = useState<DraftField[]>([]);
  const [preview, setPreview] = useState(false);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setStatus(existing.status);
    setFields(existing.fields.sort((a, b) => a.position - b.position).map((f: QuestionnaireField) => ({ label: f.label, required: f.required, tooltip: f.tooltip ?? '', dataField: f.dataField, options: f.options })));
  }, [existing]);
  useEffect(() => {
    if (searchParams.get('preview') === '1' && existing) setPreview(true);
  }, [searchParams, existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const onDrop = (targetIdx: number) => {
    const from = dragIndex.current;
    if (from === null || from === targetIdx) return;
    setFields((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(targetIdx, 0, moved!);
      return next;
    });
    dragIndex.current = null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name, status,
      fields: fields.map((f) => ({ label: f.label, required: f.required, tooltip: f.tooltip || null, dataField: f.dataField, options: f.dataField === 'select' ? f.options : [] })),
    };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-applications');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Questionnaire' : 'Add Questionnaire'} subtitle={`Partners › Offer Applications › Questionnaires › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>

          <div>
            <label className="label mb-2 block">Status *</label>
            <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
              {(['active', 'inactive'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-small font-medium transition-colors ${status === s ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
                  <span className={`h-2 w-2 rounded-full ${s === 'active' ? 'bg-success' : 'bg-warning'}`} />
                  {s === 'active' ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label mb-2 block">Fields</label>
            <button type="button" onClick={() => setFields((f) => [...f, emptyField()])}
              className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg hover:bg-accent-subtle">+</button>
          </div>

          {fields.length === 0
            ? <div className="rounded-card border border-border p-4 text-small text-fg-secondary">No custom field is defined.</div>
            : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <FieldCard key={i} index={i} field={f}
                    onChange={(nf) => setFields((cur) => cur.map((x, xi) => (xi === i ? nf : x)))}
                    onRemove={() => setFields((cur) => cur.filter((_, xi) => xi !== i))}
                    dragHandlers={{
                      draggable: true,
                      onDragStart: () => { dragIndex.current = i; },
                      onDragOver: (e) => e.preventDefault(),
                      onDrop: () => onDrop(i),
                    }}
                  />
                ))}
              </div>
            )}

          <button type="button" className="btn-ghost" onClick={() => setPreview(true)}>Preview Questionnaire</button>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-applications" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>

      {preview && <PreviewModal name={name} fields={fields} onClose={() => setPreview(false)} />}
    </>
  );
}

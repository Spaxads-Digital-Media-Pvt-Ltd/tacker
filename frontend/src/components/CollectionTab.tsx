/**
 * Generic list + add + edit + delete panel for a nested REST collection (e.g. an offer's goals,
 * creatives, coupons, deals). Declarative: pass the collection's base path, the form fields, and how
 * to render each row. Edit is opt-in (`editable`) since only collections with a PATCH endpoint
 * support it (goals/creatives/coupons/deals); geo-rules/access/tags are add+delete only.
 *
 * CRUD targets `${basePath}` (POST) and `${basePath}/${row.id}` (PATCH/DELETE).
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { useQuery, useMutation } from '../lib/useApi';
import { Table, Modal, Field, Spinner, StateBlock, type Column } from './ui';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'select' | 'checkbox' | 'url' | 'textarea' | 'tags' | 'hidden';
  options?: string[] | { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  default?: string | boolean;
}

interface Row { id: string; [k: string]: unknown; }

function optionList(o: FieldDef['options']): { value: string; label: string }[] {
  return (o ?? []).map((x) => (typeof x === 'string' ? { value: x, label: x } : x));
}

function initialForm(fields: FieldDef[]): Record<string, string | boolean> {
  const f: Record<string, string | boolean> = {};
  for (const fd of fields) f[fd.key] = fd.default ?? (fd.type === 'checkbox' ? false : '');
  return f;
}

/** Seed a form from an existing row (edit mode). Array-valued (`tags`) fields are joined for editing. */
function formFromRow(fields: FieldDef[], row: Row): Record<string, string | boolean> {
  const f: Record<string, string | boolean> = {};
  for (const fd of fields) {
    const v = row[fd.key];
    if (fd.type === 'checkbox') { f[fd.key] = Boolean(v); continue; }
    if (fd.type === 'tags') { f[fd.key] = Array.isArray(v) ? v.join(', ') : ''; continue; }
    f[fd.key] = v == null ? '' : String(v);
  }
  return f;
}

/** Convert the form state into a request body: numbers coerced, `tags` split into an array, blanks
 * on optional fields dropped. */
function toBody(fields: FieldDef[], form: Record<string, string | boolean>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const fd of fields) {
    const v = form[fd.key];
    if (fd.type === 'checkbox') { body[fd.key] = Boolean(v); continue; }
    if (fd.type === 'tags') { body[fd.key] = String(v).split(',').map((s) => s.trim()).filter(Boolean); continue; }
    if (v === '' || v === undefined) { if (fd.required) body[fd.key] = v; continue; }
    body[fd.key] = fd.type === 'number' ? Number(v) : v;
  }
  return body;
}

export function CollectionTab({
  basePath, listPath, fields, columns, addLabel, emptyText, editable = false, searchKeys, searchPlaceholder = 'Search…',
}: {
  basePath: string;
  /** GET target, if it needs query params (e.g. a category filter) that mustn't leak into the
   * `${basePath}/${id}` PATCH/DELETE URLs. Defaults to `basePath`. */
  listPath?: string;
  fields: FieldDef[];
  columns: Column<Row>[];
  addLabel: string;
  emptyText: string;
  editable?: boolean;
  /** When set, renders a search box that client-side filters the fetched rows by these row keys. */
  searchKeys?: string[];
  searchPlaceholder?: string;
}) {
  const { data, loading, error, refetch } = useQuery<Row[]>(listPath ?? basePath);
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    if (!data || !searchKeys?.length || !q.trim()) return data;
    const needle = q.trim().toLowerCase();
    return data.filter((row) => searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(needle)));
  }, [data, searchKeys, q]);

  const del = useMutation((id: string) => api.del(`${basePath}/${id}`));
  const withActions = useMemo<Column<Row>[]>(() => [
    ...columns,
    {
      header: '', className: 'text-right',
      cell: (row) => (
        <span className="flex justify-end gap-3">
          {editable && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setEditRow(row)}>Edit</button>}
          <button className="text-tiny font-medium text-danger-text hover:underline"
            onClick={async () => { if (confirm('Delete this item?')) { await del.run(row.id); refetch(); } }}>Delete</button>
        </span>
      ),
    },
  ], [columns, del, refetch, editable]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {searchKeys?.length ? (
          <div className="relative mr-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="input !w-full sm:!w-64 !pl-8" />
          </div>
        ) : null}
        <button className="btn-primary" onClick={() => setOpen(true)}>{addLabel}</button>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>{emptyText}</StateBlock>
        : !shown || shown.length === 0 ? <StateBlock>No rows match “{q}”.</StateBlock>
        : <Table columns={withActions} rows={shown} rowKey={(r) => r.id} />}

      {open && <FormModal title={addLabel} fields={fields}
        onSubmit={(body) => api.post(basePath, body)}
        onClose={() => setOpen(false)} onDone={() => { setOpen(false); refetch(); }} />}

      {editRow && <FormModal title="Edit" fields={fields} initial={editRow}
        onSubmit={(body) => api.patch(`${basePath}/${editRow.id}`, body)}
        onClose={() => setEditRow(null)} onDone={() => { setEditRow(null); refetch(); }} />}
    </div>
  );
}

function FormModal({
  title, fields, initial, onSubmit, onClose, onDone,
}: {
  title: string; fields: FieldDef[]; initial?: Row;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState<Record<string, string | boolean>>(() => initial ? formFromRow(fields, initial) : initialForm(fields));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => onSubmit(body));
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(toBody(fields, form));
    if (res !== null) onDone();
  };

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-small text-danger-text">{error}</p>}
        {fields.filter((fd) => fd.type !== 'hidden').map((fd) => (
          <Field key={fd.key} label={fd.label}>{renderInput(fd, form[fd.key] ?? '', (v) => set(fd.key, v))}</Field>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function renderInput(fd: FieldDef, value: string | boolean, onChange: (v: string | boolean) => void): ReactNode {
  if (fd.type === 'checkbox') {
    return (
      <input type="checkbox" className="h-4 w-4 accent-accent" checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)} />
    );
  }
  if (fd.type === 'select') {
    return (
      <select className="input" required={fd.required} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {!fd.required && <option value="">—</option>}
        {optionList(fd.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (fd.type === 'textarea') {
    return <textarea className="input min-h-[80px]" required={fd.required} value={String(value)}
      placeholder={fd.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      className="input"
      type={fd.type === 'number' ? 'number' : fd.type === 'url' ? 'url' : 'text'}
      required={fd.required}
      placeholder={fd.placeholder}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

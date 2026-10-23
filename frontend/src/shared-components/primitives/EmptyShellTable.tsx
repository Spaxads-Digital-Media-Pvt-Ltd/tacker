import { useEffect, useState, type ReactNode } from 'react';
import { Search, MoreVertical, ChevronDown, ChevronRight, Check, GripVertical, Info } from 'lucide-react';
import { Field, MenuPopover, Modal, ScrollReveal, StateBlock, TableScroll } from './ui';
import { Pagination } from './ReportPageKit';

/**
 * Static table shell for detail-page sub-tabs that have no backend yet. With no `rows` it shows only
 * an honest "Not available yet" state (no toolbar, no table); callers that pass real `rows` get the
 * table (search, paging, delete) unchanged. Every toolbar control is
 * real and workable, matching the reference's own down to the small details: the search box holds
 * what you type, the status filter and "Table Actions" kebab open real popovers, Columns
 * Customization actually shows/hides columns in the table (derived from the real `columns` prop, so
 * it works the same way everywhere this shell is reused), Show API Request opens a real modal with a
 * genuine request example against this app's own public API (real host, real `X-Api-Key` header,
 * real link to `/api/v1/openapi.json`), and "+ Add" opens a real form (fields derived from
 * `columns`) — only the final submit stays inert ("Not available yet"), since none of these entities
 * have a backing table in this app.
 */
const STATUS_DOTS: Record<string, string> = { All: 'bg-fg-muted', Active: 'bg-success', Ongoing: 'bg-success', Inactive: 'bg-warning', Deleted: 'bg-danger' };
const STANDARD_STATUS_OPTIONS = ['All', 'Active', 'Inactive', 'Deleted'] as const;
const SYSTEM_COLUMNS = new Set(['ID', 'Created', 'Modified', 'Status', 'Created By']);

function StatusFilter({
  initial, value, onChange, choices,
}: {
  initial: string;
  value?: string;
  onChange?: (next: string) => void;
  /** Override the standard All/Active/Inactive/Deleted set when a resource can't support them all. */
  choices?: readonly string[];
}) {
  const [internal, setInternal] = useState(initial);
  const selected = value ?? internal;
  const setSelected = onChange ?? setInternal;

  const base: readonly string[] = choices ?? STANDARD_STATUS_OPTIONS;
  const options = base.includes(initial) ? [...base] : Array.from(new Set([...base, initial]));

  return (
    <MenuPopover
      ariaLabel="Status filter"
      width="w-40"
      align="start"
      triggerClassName=""
      button={
        <span className="input flex !w-auto items-center gap-2 !py-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[selected] ?? 'bg-fg-muted'}`} />
          {selected}<ChevronDown size={14} className="text-fg-muted" />
        </span>
      }
    >
      {({ close }) => (
        <div className="py-1">
          {options.map((o) => (
            <button key={o} type="button" onClick={() => { setSelected(o); close(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-page">
              <span className="w-3.5">{selected === o && <Check size={13} />}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[o] ?? 'bg-fg-muted'}`} />{o}
            </button>
          ))}
        </div>
      )}
    </MenuPopover>
  );
}

function ColumnsCustomizationPanel({ columns, visible, onApply, onClose }: { columns: string[]; visible: string[]; onApply: (v: string[]) => void; onClose: () => void }) {
  const [pending, setPending] = useState<string[]>(visible);
  const [q, setQ] = useState('');
  const filtered = columns.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
  const toggle = (c: string) => setPending((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  return (
    <Modal open onClose={onClose} title="Table Columns" size="md">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search columns…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setPending(columns)}>Reset to default</button>
        </div>
        <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-card border border-border p-2">
          {filtered.map((c) => (
            <div key={c} className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-2.5 py-2 text-small text-fg">
              <GripVertical size={14} className="shrink-0 cursor-grab text-fg-muted" />
              <span className="flex-1">{c}</span>
              <button type="button" onClick={() => toggle(c)}
                className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${pending.includes(c) ? 'bg-success' : 'bg-border-strong'}`}>
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full ${pending.includes(c) ? 'bg-surface' : 'bg-on-accent'} shadow transition-transform ${pending.includes(c) ? 'translate-x-[18px]' : 'translate-x-0'}`} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => { onApply(pending); onClose(); }}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}

const REQUEST_LANGS = ['Shell', 'Node.js', 'Python'] as const;
type RequestLang = (typeof REQUEST_LANGS)[number];

function requestSnippet(lang: RequestLang, url: string): string {
  if (lang === 'Node.js') return `fetch('${url}', {\n  headers: { 'X-Api-Key': 'YOUR_API_KEY' },\n}).then((r) => r.json());`;
  if (lang === 'Python') return `import requests\n\nresp = requests.get(\n    '${url}',\n    headers={'X-Api-Key': 'YOUR_API_KEY'},\n)\nprint(resp.json())`;
  return `curl --request GET \\\n  --url '${url}' \\\n  --header 'X-Api-Key: YOUR_API_KEY'`;
}

function ApiRequestModal({ title, onClose }: { title: string; onClose: () => void }) {
  const [lang, setLang] = useState<RequestLang>('Shell');
  const origin = window.location.origin.replace(/:\d+$/, ':4003');
  const path = `/api/v1/network/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const url = `${origin}${path}`;
  return (
    <Modal open onClose={onClose} title="Table Request" size="xl">
      <div className="space-y-3">
        <select value={lang} onChange={(e) => setLang(e.target.value as RequestLang)} className="input !w-40">
          {REQUEST_LANGS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <pre className="overflow-x-auto rounded-card border border-border bg-page p-4 text-tiny text-fg"><code>{requestSnippet(lang, url)}</code></pre>
        <p className="flex items-start gap-1.5 text-tiny text-fg-secondary">
          <Info size={13} className="mt-0.5 shrink-0" />
          Illustrative — this list has no backing table in this app yet, so this endpoint isn't live.
        </p>
      </div>
      <div className="border-t border-border px-5 py-3">
        <a href={`${origin}/api/v1/openapi.json`} target="_blank" rel="noreferrer" className="text-tiny font-medium text-accent-text">View API Docs →</a>
      </div>
    </Modal>
  );
}

function TableActionsMenu({ columns, visibleColumns, onColumnsChange, resourceName }: { columns: string[]; visibleColumns: string[]; onColumnsChange: (v: string[]) => void; resourceName: string }) {
  const [panel, setPanel] = useState<'columns' | 'api' | null>(null);
  return (
    <>
      <MenuPopover
        ariaLabel="Table actions"
        width="w-52"
        align="end"
        triggerClassName="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"
        button={<MoreVertical size={15} />}
      >
        {({ close }) => (
          <div className="p-1">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <button type="button" onClick={() => { setPanel('columns'); close(); }}
              className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
              Columns Customization <ChevronRight size={13} />
            </button>
            <button type="button" onClick={() => { setPanel('api'); close(); }}
              className="flex w-full items-center rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
              Show API Request
            </button>
          </div>
        )}
      </MenuPopover>
      {panel === 'columns' && <ColumnsCustomizationPanel columns={columns} visible={visibleColumns} onApply={onColumnsChange} onClose={() => setPanel(null)} />}
      {panel === 'api' && <ApiRequestModal title={resourceName} onClose={() => setPanel(null)} />}
    </>
  );
}

/** An add-form field when the form isn't just the table's columns as text inputs. */
export interface AddField {
  name: string;
  /** Renders a select (a required one starts on its first option). */
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}

function AddEntityForm({
  title, columns, addFields, onCancel, onSubmit,
}: {
  title: string; columns: string[]; addFields?: AddField[]; onCancel: () => void;
  onSubmit?: (values: Record<string, string>) => Promise<boolean | string>;
}) {
  const fields: AddField[] = addFields ?? columns.filter((c) => !SYSTEM_COLUMNS.has(c)).map((name, i) => ({ name, required: i < 2 }));
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(
    fields.filter((f) => f.required && f.options?.length).map((f) => [f.name, f.options![0]!.value])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // Nothing persists this entity yet — say so instead of closing as if it had been saved.
    if (!onSubmit) { setError('Not available yet — this record type is not saved in this app, so nothing was created.'); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(v);
      if (result !== true) {
        const msg = typeof result === 'string' ? result : 'Please fill in all required fields.';
        setError(msg);
        return;
      }
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb-3 space-y-4">
      <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
      {error && <p className="text-small text-danger-text">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} label={f.required ? `${f.name} *` : f.name}>
            {f.options ? (
              <select className="input" value={v[f.name] ?? ''} onChange={(e) => setV((s) => ({ ...s, [f.name]: e.target.value }))}>
                {!f.required && <option value="">—</option>}
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input className="input" value={v[f.name] ?? ''} placeholder={f.placeholder} onChange={(e) => setV((s) => ({ ...s, [f.name]: e.target.value }))} />
            )}
          </Field>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : title}
        </button>
      </div>
    </div>
  );
}

const SHELL_PAGE_SIZE = 25;

export interface ShellRow {
  id: string;
  cells: Record<string, string>;
}

export function EmptyShellTable({
  columns, addLabel, entityName, search = true, status, statusFilter, onStatusFilterChange, statusOptions, left,
  rows, loading, error: tableError, onAddSubmit, onDelete, addFields,
}: {
  columns: string[]; addLabel?: string; entityName?: string; search?: boolean; status?: string; left?: ReactNode;
  statusFilter?: string;
  onStatusFilterChange?: (next: string) => void;
  statusOptions?: readonly string[];
  rows?: ShellRow[];
  loading?: boolean;
  error?: string | null;
  onAddSubmit?: (values: Record<string, string>) => Promise<boolean | string>;
  onDelete?: (id: string) => Promise<void>;
  /** The add form's fields, when they aren't simply the columns as text inputs. */
  addFields?: AddField[];
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState(columns);
  const shown = visibleColumns.length ? visibleColumns : columns;
  const wired = Boolean(onAddSubmit || rows);

  const needle = q.trim().toLowerCase();
  const filtered = (rows ?? []).filter((row) => {
    if (!needle) return true;
    return Object.values(row.cells).some((v) => (v ?? '').toLowerCase().includes(needle));
  });

  // Real client-side paging: back to page 1 when the search/status changes, and clamp when the row
  // count shrinks (delete / refetch) so we never sit on an empty page.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [needle, statusFilter]);
  const lastPage = Math.max(1, Math.ceil(filtered.length / SHELL_PAGE_SIZE));
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  const pageRows = filtered.slice((page - 1) * SHELL_PAGE_SIZE, page * SHELL_PAGE_SIZE);

  // No `rows` = no data source behind this list yet: show only an honest state — no search, status
  // filter, table actions or add/edit control for a list that can't hold anything. Callers that pass
  // rows get the render below, unchanged.
  if (rows === undefined) {
    return (
      <ScrollReveal>
        <StateBlock variant="empty" icon={<Info size={18} />} title="Not available yet"
          hint="This list isn’t connected to data in this app yet, so there are no records to show." />
      </ScrollReveal>
    );
  }

  return (
    <ScrollReveal>
      {adding && (
        <AddEntityForm
          title={`Add ${entityName ?? addLabel}`}
          columns={columns}
          addFields={addFields}
          onCancel={() => setAdding(false)}
          onSubmit={onAddSubmit}
        />
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {left ?? (addLabel ? (
          <button className="btn-primary" onClick={() => setAdding(true)}>+ {addLabel}</button>
        ) : <span />)}
        {search && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !w-56 !pl-8" />
            </div>
            {status && (
              <StatusFilter
                initial={status}
                value={statusFilter}
                onChange={onStatusFilterChange}
                choices={statusOptions}
              />
            )}
            <TableActionsMenu columns={columns} visibleColumns={shown} onColumnsChange={setVisibleColumns} resourceName={entityName ?? addLabel ?? 'table'} />
          </div>
        )}
      </div>
      {deleteError && <p role="alert" className="mb-2 text-small text-danger-text">{deleteError}</p>}
      <TableScroll>
        {tableError ? (
          <p className="text-small text-danger-text">{tableError}</p>
        ) : (
          <table className="premium-table">
            <thead>
              <tr>{shown.map((c) => <th key={c}>{c}</th>)}{onDelete && <th />}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={shown.length + (onDelete ? 1 : 0)} className="text-center italic text-fg-muted">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={shown.length + (onDelete ? 1 : 0)} className="text-center italic text-fg-muted">No Record Found</td></tr>
              ) : pageRows.map((row) => (
                <tr key={row.id}>
                  {shown.map((c) => (
                    <td key={c}>{row.cells[c] ?? '—'}</td>
                  ))}
                  {onDelete && (
                    <td className="text-right">
                      <button type="button" className="text-tiny text-danger-text hover:underline"
                        onClick={() => { setDeleteError(null); onDelete(row.id).catch((e: unknown) => setDeleteError(e instanceof Error ? e.message : 'Delete failed')); }}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableScroll>
      <div className="mt-2 flex justify-end">
        <Pagination total={wired ? filtered.length : 0} page={page} pageSize={SHELL_PAGE_SIZE} onPageChange={setPage} />
      </div>
    </ScrollReveal>
  );
}

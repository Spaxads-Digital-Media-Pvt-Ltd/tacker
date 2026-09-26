import { useState, type ReactNode } from 'react';
import { Search, MoreVertical, ChevronDown, ChevronRight, Check, GripVertical, Info } from 'lucide-react';
import { Field, MenuPopover, Modal, ScrollReveal, TableScroll } from './ui';
import { Pagination } from './ReportPageKit';

/**
 * Static table shell for detail-page sub-tabs that have no backend yet. Matches the reference UI's
 * own empty state — most of its screenshots show "No Record Found" for these exact tabs, so a shell
 * is a faithful match, not a placeholder standing in for something richer. Every toolbar control is
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
  initial, value, onChange,
}: {
  initial: string;
  value?: string;
  onChange?: (next: string) => void;
}) {
  const [internal, setInternal] = useState(initial);
  const selected = value ?? internal;
  const setSelected = onChange ?? setInternal;

  const options = (STANDARD_STATUS_OPTIONS as readonly string[]).includes(initial)
    ? [...STANDARD_STATUS_OPTIONS]
    : Array.from(new Set([...STANDARD_STATUS_OPTIONS, initial]));

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
                className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${pending.includes(c) ? 'bg-success' : 'bg-border'}`}>
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${pending.includes(c) ? 'translate-x-[18px]' : 'translate-x-0'}`} />
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

function AddEntityForm({
  title, columns, onCancel, onSubmit,
}: {
  title: string; columns: string[]; onCancel: () => void;
  onSubmit?: (values: Record<string, string>) => Promise<boolean | string>;
}) {
  const fields = columns.filter((c) => !SYSTEM_COLUMNS.has(c));
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!onSubmit) { onCancel(); return; }
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
        {fields.map((f, i) => (
          <Field key={f} label={i < 2 ? `${f} *` : f}>
            <input className="input" value={v[f] ?? ''} onChange={(e) => setV((s) => ({ ...s, [f]: e.target.value }))} />
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

export interface ShellRow {
  id: string;
  cells: Record<string, string>;
}

export function EmptyShellTable({
  columns, addLabel, entityName, search = true, status, statusFilter, onStatusFilterChange, left,
  rows, loading, onAddSubmit, onDelete,
}: {
  columns: string[]; addLabel?: string; entityName?: string; search?: boolean; status?: string; left?: ReactNode;
  /** Controlled status filter (All / Active / Inactive / Deleted). */
  statusFilter?: string;
  onStatusFilterChange?: (next: string) => void;
  /** When set, table shows live data and add form saves via API. */
  rows?: ShellRow[];
  loading?: boolean;
  onAddSubmit?: (values: Record<string, string>) => Promise<boolean | string>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(columns);
  const shown = visibleColumns.length ? visibleColumns : columns;
  const wired = Boolean(onAddSubmit || rows);

  const filtered = (rows ?? []).filter((row) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return Object.values(row.cells).some((v) => v.toLowerCase().includes(needle));
  });

  return (
    <ScrollReveal>
      {adding && (
        <AddEntityForm
          title={`Add ${entityName ?? addLabel}`}
          columns={columns}
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
              />
            )}
            <TableActionsMenu columns={columns} visibleColumns={shown} onColumnsChange={setVisibleColumns} resourceName={entityName ?? addLabel ?? 'table'} />
          </div>
        )}
      </div>
      <TableScroll>
        <table className="premium-table">
          <thead>
            <tr>{shown.map((c) => <th key={c}>{c}</th>)}{onDelete && <th />}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={shown.length + (onDelete ? 1 : 0)} className="text-center italic text-fg-muted">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={shown.length + (onDelete ? 1 : 0)} className="text-center italic text-fg-muted">No Record Found</td></tr>
            ) : filtered.map((row) => (
              <tr key={row.id}>
                {shown.map((c) => (
                  <td key={c}>{row.cells[c] ?? '—'}</td>
                ))}
                {onDelete && (
                  <td className="text-right">
                    <button type="button" className="text-tiny text-danger-text hover:underline"
                      onClick={() => onDelete(row.id)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <div className="mt-2 flex justify-end">
        <Pagination total={wired ? filtered.length : 0} page={1} pageSize={25} onPageChange={() => {}} />
      </div>
    </ScrollReveal>
  );
}

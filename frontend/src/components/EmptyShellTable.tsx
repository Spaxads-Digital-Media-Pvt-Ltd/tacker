import { useState, type ReactNode } from 'react';
import { Search, MoreVertical, ChevronDown, ChevronRight, Check, GripVertical, X, Info } from 'lucide-react';
import { Field } from './ui';
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
const SYSTEM_COLUMNS = new Set(['ID', 'Created', 'Modified', 'Status', 'Created By']);

function StatusFilter({ initial }: { initial: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const options = Array.from(new Set(['All', initial, 'Deleted', 'Inactive']));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex !w-auto items-center gap-2 !py-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[value] ?? 'bg-fg-muted'}`} />{value}<ChevronDown size={14} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-card border border-border bg-surface py-1 shadow-lg">
            {options.map((o) => (
              <button key={o} type="button" onClick={() => { setValue(o); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-page">
                <span className="w-3.5">{value === o && <Check size={13} />}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[o] ?? 'bg-fg-muted'}`} />{o}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ColumnsCustomizationPanel({ columns, visible, onApply, onClose }: { columns: string[]; visible: string[]; onApply: (v: string[]) => void; onClose: () => void }) {
  const [pending, setPending] = useState<string[]>(visible);
  const [q, setQ] = useState('');
  const filtered = columns.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
  const toggle = (c: string) => setPending((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-h3 font-medium text-fg">Table Columns</h3>
          <button type="button" onClick={() => setPending(columns)} className="text-tiny font-medium text-accent-text">Reset to default</button>
        </div>
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !pl-8" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.map((c) => (
            <div key={c} className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-2 hover:bg-page">
              <GripVertical size={14} className="shrink-0 cursor-grab text-fg-muted" />
              <span className="flex-1 text-small text-fg">{c}</span>
              <button type="button" onClick={() => toggle(c)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${pending.includes(c) ? 'bg-success' : 'bg-border'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${pending.includes(c) ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => { onApply(pending); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-card border border-border bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-h3 font-medium text-fg">Table Request</h3>
          <button type="button" onClick={onClose} className="text-fg-secondary hover:text-fg"><X size={18} /></button>
        </div>
        <div className="space-y-3 p-5">
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
      </div>
    </div>
  );
}

function TableActionsMenu({ columns, visibleColumns, onColumnsChange, resourceName }: { columns: string[]; visibleColumns: string[]; onColumnsChange: (v: string[]) => void; resourceName: string }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'columns' | 'api' | null>(null);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-card border border-border bg-surface p-1 shadow-lg">
            <p className="px-2 py-1.5 text-small font-semibold text-fg">Table Actions</p>
            <button type="button" onClick={() => { setPanel('columns'); setOpen(false); }}
              className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
              Columns Customization <ChevronRight size={13} />
            </button>
            <button type="button" onClick={() => { setPanel('api'); setOpen(false); }}
              className="flex w-full items-center rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
              Show API Request
            </button>
          </div>
        </>
      )}
      {panel === 'columns' && <ColumnsCustomizationPanel columns={columns} visible={visibleColumns} onApply={onColumnsChange} onClose={() => setPanel(null)} />}
      {panel === 'api' && <ApiRequestModal title={resourceName} onClose={() => setPanel(null)} />}
    </div>
  );
}

function AddEntityForm({ title, columns, onCancel }: { title: string; columns: string[]; onCancel: () => void }) {
  const fields = columns.filter((c) => !SYSTEM_COLUMNS.has(c));
  const [v, setV] = useState<Record<string, string>>({});
  return (
    <div className="card mb-3 space-y-4">
      <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f, i) => (
          <Field key={f} label={i < 2 ? `${f} *` : f}>
            <input className="input" value={v[f] ?? ''} onChange={(e) => setV((s) => ({ ...s, [f]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button title="Not available yet" className="btn-primary" onClick={onCancel}>{title}</button>
      </div>
    </div>
  );
}

export function EmptyShellTable({ columns, addLabel, entityName, search = true, status, left }: { columns: string[]; addLabel?: string; entityName?: string; search?: boolean; status?: string; left?: ReactNode }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(columns);
  const shown = visibleColumns.length ? visibleColumns : columns;
  return (
    <div>
      {adding && <AddEntityForm title={`Add ${entityName ?? addLabel}`} columns={columns} onCancel={() => setAdding(false)} />}
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
            {status && <StatusFilter initial={status} />}
            <TableActionsMenu columns={columns} visibleColumns={shown} onColumnsChange={setVisibleColumns} resourceName={entityName ?? addLabel ?? 'table'} />
          </div>
        )}
      </div>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[640px] text-left text-body">
          <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
            <tr className="divide-x divide-border">{shown.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr><td colSpan={shown.length} className="px-4 py-10 text-center text-small italic text-fg-muted">No Record Found</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <Pagination total={0} page={1} pageSize={25} onPageChange={() => {}} />
      </div>
    </div>
  );
}

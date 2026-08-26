/**
 * Shared widgets for "Manage X" list pages' Table Actions kebab (Everflow-style), first built for
 * Manage Offers and reused for Manage Partners: a "Table Columns" modal (search, toggle switches,
 * drag-to-reorder, Reset to default) and a "Table Request" modal (shows the actual request the page
 * issues, honestly noting when filtering happens client-side rather than as query params).
 */
import { useRef, useState } from 'react';
import { GripVertical, Search as SearchIcon } from 'lucide-react';
import { Modal } from './ui';

export function ColumnsModal({
  allColumns, order, hidden, onClose, onApply,
}: {
  allColumns: readonly string[];
  order: string[];
  hidden: Set<string>;
  onClose: () => void;
  onApply: (order: string[], hidden: Set<string>) => void;
}) {
  const [draftOrder, setDraftOrder] = useState(order);
  const [draftHidden, setDraftHidden] = useState(hidden);
  const [q, setQ] = useState('');
  const dragIndex = useRef<number | null>(null);

  const toggle = (c: string) => setDraftHidden((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const reset = () => { setDraftOrder([...allColumns]); setDraftHidden(new Set()); };

  const onDrop = (targetIdx: number) => {
    const from = dragIndex.current;
    if (from === null || from === targetIdx) return;
    setDraftOrder((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(targetIdx, 0, moved!);
      return next;
    });
    dragIndex.current = null;
  };

  const visibleList = draftOrder.filter((c) => c.toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal open onClose={onClose} title="Table Columns">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="relative">
            <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-48 !pl-7" placeholder="Search columns…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={reset}>Reset to default</button>
        </div>
        <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-card border border-border p-2">
          {visibleList.map((c) => {
            const idx = draftOrder.indexOf(c);
            return (
              <div
                key={c}
                draggable
                onDragStart={() => { dragIndex.current = idx; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(idx)}
                className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface px-2.5 py-2 text-small text-fg"
              >
                <GripVertical size={14} className="shrink-0 cursor-grab text-fg-muted" />
                <span className="flex-1">{c}</span>
                <button type="button" role="switch" aria-checked={!draftHidden.has(c)} onClick={() => toggle(c)}
                  className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${!draftHidden.has(c) ? 'bg-success' : 'bg-border'}`}>
                  <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${!draftHidden.has(c) ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => { onApply(draftOrder, draftHidden); onClose(); }}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}

/** Shows the actual request this page issues — filtering happens client-side today, so that's
 * called out rather than faked as server-side query params. */
export function ApiRequestModal({
  onClose, path, appliedFilters,
}: { onClose: () => void; path: string; appliedFilters: Record<string, string | undefined> }) {
  const activeFilters = Object.entries(appliedFilters).filter(([, v]) => v);
  const curl = [
    `curl --request GET \\`,
    `  --url '${window.location.origin}${path}' \\`,
    `  --header 'Authorization: Bearer YOUR_ACCESS_TOKEN'`,
  ].join('\n');

  return (
    <Modal open onClose={onClose} title="Table Request">
      <div className="space-y-3">
        <p className="text-small text-fg-secondary">This is the real request this page issues to load this table.</p>
        <pre className="overflow-x-auto rounded-card border border-border bg-page p-3 text-tiny text-fg"><code>{curl}</code></pre>
        {activeFilters.length > 0 && (
          <div>
            <p className="mb-1 text-tiny font-semibold uppercase text-fg-secondary">Applied on this page (client-side, not query params)</p>
            <ul className="space-y-0.5 text-small text-fg">
              {activeFilters.map(([k, v]) => <li key={k}><span className="text-fg-secondary">{k}:</span> {v}</li>)}
            </ul>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

/** Small dropdown trigger, closes on outside click. Shared by search-field and status selectors
 * rendered directly in a page's own toolbar (not portal-based — the toolbar isn't inside a clipped
 * scroll container). */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return { open, setOpen, ref };
}

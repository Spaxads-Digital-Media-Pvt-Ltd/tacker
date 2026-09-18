/**
 * Two-column Available/Selected multi-select — matches the reference's real "Offers" picker inside
 * Add/Edit Offer Group (verified live at /offers/groups/add): a single search box that filters both
 * columns, "Select All"/"Clear All", and click-to-move rows (no drag-and-drop).
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

export interface PickerOption { value: string; label: string; active?: boolean }

export function DualListPicker({ options, selected, onChange }: { options: PickerOption[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [q, setQ] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const available = options.filter((o) => !selectedSet.has(o.value));
  const chosen = options.filter((o) => selectedSet.has(o.value));
  const norm = q.trim().toLowerCase();
  const availableShown = norm ? available.filter((o) => o.label.toLowerCase().includes(norm)) : available;
  const chosenShown = norm ? chosen.filter((o) => o.label.toLowerCase().includes(norm)) : chosen;

  const add = (v: string) => onChange([...selected, v]);
  const remove = (v: string) => onChange(selected.filter((x) => x !== v));

  return (
    <div className="rounded-card border border-border bg-page">
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in both, available and selected"
            className="input !pl-8" />
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-border">
        <div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-small font-semibold text-fg">Available</span>
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => onChange([...selected, ...availableShown.map((o) => o.value)])}>Select All</button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {availableShown.length === 0 ? (
              <p className="px-3 py-3 text-tiny text-fg-muted">Nothing available.</p>
            ) : availableShown.map((o) => (
              <button key={o.value} type="button" onClick={() => add(o.value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-small text-fg hover:bg-accent-subtle">
                <span className={`h-2 w-2 shrink-0 rounded-full ${o.active ? 'bg-success' : 'bg-warning'}`} />
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-small font-semibold text-fg">Selected</span>
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => onChange(selected.filter((v) => !chosenShown.some((o) => o.value === v)))}>Clear All</button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {chosenShown.length === 0 ? (
              <p className="px-3 py-3 text-tiny text-fg-muted">Nothing selected.</p>
            ) : chosenShown.map((o) => (
              <button key={o.value} type="button" onClick={() => remove(o.value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-small text-fg hover:bg-danger-bg">
                <span className={`h-2 w-2 shrink-0 rounded-full ${o.active ? 'bg-success' : 'bg-warning'}`} />
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small form controls shared by the Offer Create / Edit forms. */
import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function YesNoToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${on ? 'text-accent-text' : 'text-fg-secondary'}`}>
      {on ? 'Yes' : 'No'}
      <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-success' : 'bg-border'}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

/** Left list + right panel picker (Targeting tab). `badge` shows a count per row. */
export function CategoryPicker({ categories, panel, badge }: {
  categories: string[]; panel: (c: string) => ReactNode; badge?: (c: string) => number;
}) {
  const [active, setActive] = useState<string>(categories[0] ?? '');
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-card border border-border sm:grid-cols-[220px_1fr]">
      <div className="divide-y divide-border border-b border-border sm:border-b-0 sm:border-r">
        {categories.map((c) => {
          const n = badge?.(c) ?? 0;
          return (
            <button key={c} type="button" onClick={() => setActive(c)}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-small ${active === c ? 'bg-accent-subtle font-medium text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
              <span>{c}</span>
              <span className="flex items-center gap-2">
                {n > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{n}</span>}
                ›
              </span>
            </button>
          );
        })}
      </div>
      <div className="min-h-[120px] bg-page p-4">{panel(active)}</div>
    </div>
  );
}

/** Type a value, Enter (or Add) to append it as a chip. Invalid values are rejected with a message. */
export function ChipInput({ values, onChange, placeholder, suggestions, validate, normalize }: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  validate?: (v: string) => string | null;
  normalize?: (v: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const listId = suggestions ? `chips-${placeholder?.replace(/\W+/g, '-') ?? 'x'}` : undefined;
  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    const v = normalize ? normalize(raw) : raw;
    const problem = validate?.(v) ?? null;
    if (problem) { setErr(problem); return; }
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft(''); setErr(null);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input" value={draft} list={listId} placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-ghost shrink-0" onClick={add}>Add</button>
        {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
      </div>
      {err && <p className="text-tiny text-danger-text">{err}</p>}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-tiny text-fg">
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-fg-muted hover:text-fg"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

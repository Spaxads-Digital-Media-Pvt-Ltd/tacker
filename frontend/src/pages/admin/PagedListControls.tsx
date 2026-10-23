/**
 * Small controls shared by the server-paged Manage Offers / Partners / Advertisers pages.
 */
import { ChevronDown } from 'lucide-react';
import { useDropdown } from '../../shared-components/primitives/TableActionsKit';

export interface SortOption { value: string; label: string }
/** "sort:dir" options, e.g. { value: 'createdAt:desc', label: 'Newest first' }. */
export function SortSelect({ value, options, onChange }: { value: string; options: SortOption[]; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const current = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input !w-auto flex items-center gap-1.5" onClick={() => setOpen((o) => !o)} title="Sort">
        <span className="text-fg-muted">Sort:</span> {current.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-popover mt-1 w-48 rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {o.label}{o.value === value && <span className="text-accent-text">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small dismissible notice (export capped / failed). */
export function ExportNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-card border border-warning/40 bg-warning-bg px-3 py-2 text-small text-warning-text">
      <span>{message}</span>
      <button type="button" className="text-tiny font-medium hover:underline" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/**
 * Applied-filter chips shown above a table: "Country: India ×  Status: Active ×  Clear all".
 * Removing a chip (or Clear all) changes the APPLIED filters immediately — no drawer round-trip.
 * Labels come from the same category/option lists the filter drawer uses, so chips always read as
 * names (never raw UUIDs/ISO codes); a value no longer in the options falls back to the raw value.
 */
import { X } from 'lucide-react';

import type { FilterChip } from '../../lib/filterChips';
export type { ChipCategory, FilterChip } from '../../lib/filterChips';

export function ActiveFilterChips({ chips, onRemove, onClearAll, className = '' }: {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
  className?: string;
}) {
  if (!chips.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} aria-label="Active filters">
      {chips.map((c) => (
        <span key={`${c.exclude ? 'x' : 'f'}:${c.key}:${c.value}`}
          className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-tiny ${c.exclude ? 'border-danger bg-danger-bg text-danger-text' : 'border-border bg-surface text-fg'}`}>
          <span className="text-fg-muted">{c.exclude ? `Not ${c.label}` : c.label}:</span>
          <span className="truncate font-medium" title={c.valueLabel}>{c.valueLabel}</span>
          <button type="button" aria-label={`Remove ${c.label} ${c.valueLabel}`} onClick={() => onRemove(c)}
            className="ml-0.5 text-fg-muted hover:text-fg"><X size={11} /></button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="ml-1 text-tiny font-medium text-accent-text hover:underline">Clear all</button>
    </div>
  );
}

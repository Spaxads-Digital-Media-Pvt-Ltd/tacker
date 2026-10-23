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
    <div className={`flex flex-wrap items-center gap-2 ${className}`} aria-label="Active filters">
      {chips.map((c) => (
        <span key={`${c.exclude ? 'x' : 'f'}:${c.key}:${c.value}`}
          className={`inline-flex max-w-full items-center gap-1 rounded-full py-1 pl-2.5 pr-1.5 text-tiny ${c.exclude ? 'bg-danger-bg text-danger-text' : 'bg-accent-subtle text-accent-text'}`}>
          <span className="whitespace-nowrap">{c.exclude ? `Not ${c.label}` : c.label}:</span>
          <span className="truncate font-semibold" title={c.valueLabel}>{c.valueLabel}</span>
          {/* Focus outline in the chip's own text colour: --focus-ring is 2.92:1 on accent-subtle in light. */}
          <button type="button" aria-label={`Remove ${c.label} ${c.valueLabel}`} onClick={() => onRemove(c)}
            className="ml-0.5 grid place-items-center rounded-full p-0.5 hover:text-fg focus-visible:outline-current"><X size={12} aria-hidden /></button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="ml-1 text-tiny font-medium text-accent-text hover:underline">Clear all</button>
    </div>
  );
}

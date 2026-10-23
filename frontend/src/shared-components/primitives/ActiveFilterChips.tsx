/**
 * Applied-filter chips shown above a table: "Country: India ×  Status: Active ×  Clear all".
 * Removing a chip (or Clear all) changes the APPLIED filters immediately — no drawer round-trip.
 * Labels come from the same category/option lists the filter drawer uses, so chips always read as
 * names (never raw UUIDs/ISO codes); a value no longer in the options falls back to the raw value.
 *
 * Chips are 28 px pills (accent tint + a faint accent border; "Not …" exclusions in the danger
 * pair): the field name in a quieter neutral, the value in medium weight (wrapping, never
 * truncated), and a 20 px round remove button. "Clear all" is a ghost button of the same height.
 */
import { X } from 'lucide-react';

import type { FilterChip } from '../../lib/filterChips';
export type { ChipCategory, FilterChip } from '../../lib/filterChips';

export function ActiveFilterChips({ chips, onRemove, onClearAll, inline = false, className = '' }: {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
  /** Join the surrounding toolbar's wrapping flex row (the wrapper becomes `display: contents`, so
   * each chip and Clear all are items of that row and share its 8 px gaps). */
  inline?: boolean;
  className?: string;
}) {
  if (!chips.length) return null;
  return (
    <div className={inline ? 'contents' : `flex flex-wrap items-center gap-2 ${className}`} aria-label="Active filters">
      {chips.map((c) => {
        const name = c.exclude ? `Not ${c.label}` : c.label;
        return (
          <span key={`${c.exclude ? 'x' : 'f'}:${c.key}:${c.value}`}
            className={`inline-flex min-h-7 max-w-full items-center gap-1 rounded-[0.875rem] border py-0.5 pl-3 pr-1 text-tiny ${c.exclude ? 'border-danger-text/25 bg-danger-bg text-danger-text' : 'border-accent-text/25 bg-accent-subtle text-accent-text'}`}>
            {/* Field name: neutral secondary on the accent tint (5.33:1 light) — the accent at a lower
                opacity would fall under 4.5:1 there. */}
            <span className={`whitespace-nowrap ${c.exclude ? '' : 'text-fg-secondary'}`}>{name}:</span>
            {/* Never truncated: a value wider than the toolbar wraps inside the chip (the chip grows past
                28 px only then; the 14 px radius keeps a one-line chip a pill). */}
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]" title={c.valueLabel}>{c.valueLabel}</span>
            {/* Focus outline in the chip's own text colour: --focus-ring is 2.92:1 on accent-subtle in light. */}
            <button type="button" aria-label={`Remove ${name}: ${c.valueLabel}`} onClick={() => onRemove(c)}
              className={`ml-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors duration-fast focus-visible:outline-current ${c.exclude ? 'hover:bg-danger-text/15' : 'hover:bg-accent-text/15'}`}>
              <X size={12} aria-hidden />
            </button>
          </span>
        );
      })}
      <button type="button" onClick={onClearAll}
        className="inline-flex h-7 items-center rounded-full px-2.5 text-tiny font-medium text-accent-text transition-colors duration-fast hover:bg-accent-subtle">
        Clear all
      </button>
    </div>
  );
}

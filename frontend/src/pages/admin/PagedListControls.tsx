/**
 * Small controls shared by the server-paged Manage Offers / Partners / Advertisers pages.
 */
import type { ReactNode } from 'react';
import { MenuSelect } from '../../shared-components/primitives/ui';
import { ActiveFilterChips, type FilterChip } from '../../shared-components/primitives/ActiveFilterChips';

/**
 * List toolbar: the controls (`lead` search, selects, Filters) and the active filter chips share ONE
 * wrapping row on the left — chips sit right after Filters; the primary action(s) and ⋮ are their own
 * column, pinned to the first row on the right, so chips never push them down or off-screen. Chips
 * that don't fit wrap onto the next line from the toolbar's left edge (8 px row / column gaps); with
 * no active filters nothing extra renders. DOM (and tab) order = lead → controls → chips → actions.
 *
 * Below sm it is a two-column grid: row 1 = `lead` + the actions, and the other controls and the
 * chips wrap underneath across the full width (so a narrow phone doesn't give every control its own
 * row beside the actions column). The wrappers are `display: contents` from sm, where everything is
 * one flex row again.
 */
export function FilterToolbar({ lead, children, chips, onRemoveChip, onClearAll, actions, className = '' }: {
  /** The search group — shares the first row with the actions on a phone. */
  lead?: ReactNode;
  children: ReactNode;
  chips: FilterChip[];
  onRemoveChip: (chip: FilterChip) => void;
  onClearAll: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:items-start ${className}`}>
      <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-wrap sm:items-center sm:gap-2">
        {lead && <div className="col-start-1 row-start-1 min-w-0 sm:contents">{lead}</div>}
        <div className={`${lead ? 'col-span-2 row-start-2' : 'col-start-1 row-start-1'} flex min-w-0 flex-wrap items-center gap-2 sm:contents`}>
          {children}
          <ActiveFilterChips inline chips={chips} onRemove={onRemoveChip} onClearAll={onClearAll} />
        </div>
      </div>
      {/* min-h = the 43 px .input / .btn-toolbar height, so the actions centre on the first row. */}
      {actions && <div className="col-start-2 row-start-1 flex min-h-[2.6875rem] shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface SortOption { value: string; label: string }
/** "sort:dir" options, e.g. { value: 'createdAt:desc', label: 'Newest first' }. */
export function SortSelect({ value, options, onChange }: { value: string; options: SortOption[]; onChange: (v: string) => void }) {
  return <MenuSelect label="Sort" prefix="Sort:" value={value} options={options} onChange={onChange} align="end" width="w-52" />;
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

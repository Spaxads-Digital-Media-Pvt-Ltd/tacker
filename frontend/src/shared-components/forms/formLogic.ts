/**
 * Pure helpers behind the form primitives (FormSection, ChoiceCards, FieldHelpPanel) — kept out of
 * the component files so they are unit-testable without a DOM and React Fast Refresh stays happy.
 */
import { createContext, useContext } from 'react';

// ── ChoiceCards: roving-tabindex keyboard model ─────────────────────────────────────────────────

/** Next option index for a radio-group key press (wraps), or null when the key isn't navigation. */
export function nextChoiceIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (index + 1) % count;
    case 'ArrowLeft': case 'ArrowUp': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// ── FieldHelpPanel: which field is focused ──────────────────────────────────────────────────────

export interface HelpInfo { label: string; help: string | null }
interface AttrSource { getAttribute(name: string): string | null }
interface ClosestSource { closest(selector: string): AttrSource | null }

/** The label + existing hint of the Field (`data-help-label` / `data-help`) that contains `target`. */
export function helpFromTarget(target: unknown): HelpInfo | null {
  const t = target as Partial<ClosestSource> | null;
  if (!t || typeof t.closest !== 'function') return null;
  const field = t.closest('[data-help-label]');
  const label = field?.getAttribute('data-help-label');
  if (!field || !label) return null;
  return { label, help: field.getAttribute('data-help') || null };
}

// ── FormSection ─────────────────────────────────────────────────────────────────────────────────

interface Queryable { querySelector(selector: string): unknown }

/**
 * Rule: a required field never sits inside a section that is collapsed by default. True when a
 * collapsed-by-default (and mounted) section contains a `required` control — FormSection warns in dev.
 */
export function requiredInCollapsedDefault(
  opts: { collapsible: boolean; defaultOpen?: boolean; lazyMount?: boolean },
  region: Queryable | null,
): boolean {
  if (!opts.collapsible || opts.defaultOpen || opts.lazyMount || !region) return false;
  return Boolean(region.querySelector('[required]'));
}

/** A collapsed section opens when something inside shows an error (`data-field-error`, aria-invalid). */
export function regionHasError(region: Queryable | null): boolean {
  return Boolean(region?.querySelector('[data-field-error], [aria-invalid="true"]'));
}

// ── FormSectionGroup (Expand all / Collapse all) ────────────────────────────────────────────────

export interface SectionHandle { isOpen: () => boolean; setOpen: (open: boolean) => void }
export interface SectionGroupApi {
  register: (id: string, handle: SectionHandle) => () => void;
  handles: () => SectionHandle[];
  /** Re-render the group's controls (a section opened or closed). */
  bump: () => void;
  version: number;
}
export const SectionGroupContext = createContext<SectionGroupApi | null>(null);
export const useSectionGroup = (): SectionGroupApi | null => useContext(SectionGroupContext);

/** Expand all / Collapse all only shows for 3 or more collapsible sections in one form. */
export const EXPAND_ALL_MIN = 3;

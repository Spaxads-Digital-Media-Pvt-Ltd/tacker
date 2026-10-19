/**
 * Click Report › "Apply filters to narrow down your results" — the Click report's filter + field
 * modal (replaces the compact Reporting Filters flyout on this page only).
 *
 * The modal edits a DRAFT copy of the applied filters, display timezone and selected fields; Apply
 * commits it (only when every input is valid), Cancel / × / Escape / backdrop discard it. All the
 * parsing, validation and field rules live in lib/clickReportFilters.ts (unit-tested).
 *
 * Escape: an open SearchablePicker handles its own Escape (it calls preventDefault), so the modal's
 * window-level listener skips already-handled events — Escape closes the picker first, then the modal.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Filter, Search, X } from 'lucide-react';
import { Overlay } from '../../../shared-components/primitives/ui';
import { SearchablePicker, type PickerOption } from '../../../shared-components/primitives/SearchablePicker';
import { TimeZoneSelect } from '../../../shared-components/primitives/ReportTimeZone';
import type { ReportZone } from '../../../lib/useReportZone';
import {
  VISIBILITY_OPTIONS, draftErrors, draftFromApplied, filtersFromDraft, partitionFields, searchFields, selectAllState, setAllFields, toggleField,
  untrackedToggleLabel, type ClickField,
  type CapturedFilterKey, type ClickFilterDraft, type ClickFilters, type Visibility,
} from '../../../lib/clickReportFilters';

export interface ClickFiltersApply { filters: ClickFilters; timezone: string; fields: string[] }

const CAPTURED_INPUTS: { key: CapturedFilterKey; label: string; placeholder: string; mono?: boolean }[] = [
  { key: 'sourceId', label: 'Source', placeholder: 'Exact source value' },
  { key: 'fbclid', label: 'FB Click ID', placeholder: 'fbclid', mono: true },
  { key: 'gclid', label: 'Google Click ID', placeholder: 'gclid', mono: true },
];

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ClickFiltersModal({
  applied, appliedCount, timezone, fields, zone, offers, partners, advertisers, smartLinks, countries, devices,
  conversionStatuses, groupMode, focusFields = false, onApply, onClose,
}: {
  applied: ClickFilters;
  appliedCount: number;
  timezone: string;
  fields: string[];
  zone: ReportZone;
  offers: PickerOption[];
  partners: PickerOption[];
  advertisers: PickerOption[];
  smartLinks: PickerOption[];
  countries: PickerOption[];
  devices: readonly { value: string; label: string }[];
  conversionStatuses: readonly { value: string; label: string }[];
  /** Group-By mode shows grouped columns — the field selection applies to the individual-clicks table. */
  groupMode: boolean;
  /** Open with the Click Report Fields section focused (from Table Actions › Columns Customization). */
  focusFields?: boolean;
  onApply: (next: ClickFiltersApply) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ClickFilterDraft>(() => draftFromApplied(applied, timezone, fields));
  const [fieldsOpen, setFieldsOpen] = useState(true);
  const [fieldQuery, setFieldQuery] = useState('');
  const errors = draftErrors(draft);
  const valid = Object.keys(errors).length === 0;
  const uid = useId();
  const titleId = `${uid}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldSearchRef = useRef<HTMLInputElement>(null);

  const setFilter = <K extends keyof ClickFilters>(k: K, v: ClickFilters[K]) => setDraft((d) => ({ ...d, filters: { ...d.filters, [k]: v } }));
  const matching = useMemo(() => searchFields(fieldQuery), [fieldQuery]);
  const allState = selectAllState(draft.fields, matching);
  const selected = useMemo(() => new Set(draft.fields), [draft.fields]);
  // Untracked (disabled) fields sit in their own section, collapsed until asked for — display only.
  const { tracked, untracked } = useMemo(() => partitionFields(matching), [matching]);
  const [showUntracked, setShowUntracked] = useState(false);
  const fieldRow = (f: ClickField) => {
    const off = f.support === 'unavailable';
    return (
      <li key={f.key} className="min-w-0">
        {/* The whole row is the label (box + text toggle the field); untracked rows are dimmed and inert. */}
        <label className={`-mx-1.5 flex items-center gap-2.5 rounded-[var(--radius)] px-1.5 py-1 text-small ${off ? 'cursor-not-allowed text-fg-muted opacity-60' : 'cursor-pointer text-fg hover:bg-accent-subtle'}`} title={f.hint}>
          <input type="checkbox" className="chk !h-4 !w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed" disabled={off} checked={!off && selected.has(f.key)}
            onChange={(e) => setDraft((d) => ({ ...d, fields: toggleField(d.fields, f.key, e.target.checked) }))} />
          <span className="truncate">{f.label}</span>
          {off && <span className="shrink-0 text-tiny">(not tracked)</span>}
        </label>
      </li>
    );
  };

  // Focus: into the dialog on open (the fields search when opened for columns), back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      if (focusFields) fieldSearchRef.current?.focus();
      else dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);
    return () => { window.clearTimeout(t); if (opener && document.contains(opener)) opener.focus(); };
  }, [focusFields]);

  // Escape closes (discarding the draft) unless an inner control (an open picker) already handled it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep Tab inside the dialog (pickers render their panel in a portal and manage their own focus).
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current || !dialogRef.current.contains(document.activeElement)) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const firstEl = items[0]!; const lastEl = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  };

  const apply = () => {
    if (!valid) return;
    onApply({ filters: filtersFromDraft(draft), timezone: draft.timezone, fields: draft.fields });
  };

  const pick = (v: string[]) => v[0] ?? '';
  const pickerField = (label: string, id: string, options: PickerOption[], value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="min-w-0">
      <span id={`${uid}-${id}`} className="label">{label}</span>
      <SearchablePicker single options={options} value={value ? [value] : []} onChange={(v) => onChange(pick(v))}
        placeholder={placeholder} searchPlaceholder={placeholder} ariaLabel={label} />
    </div>
  );
  // The draft timezone needs a controlled select: TimeZoneSelect with value/onChange.
  const draftZone: ReportZone = { ...zone, override: draft.timezone || null, setOverride: (tz) => setDraft((d) => ({ ...d, timezone: tz ?? '' })) };

  return (
    <Overlay>
      {/* Backdrop click discards the draft (the dialog itself stops propagation). */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-4xl animate-fade-in flex-col rounded-card border border-border bg-elevated shadow-elevated"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-h3 font-semibold tracking-tight text-fg">
            <Filter size={18} className="shrink-0" aria-hidden />
            <span className="min-w-0">Apply filters to narrow down your results</span>
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-small text-fg-muted" aria-live="polite">{appliedCount} {appliedCount === 1 ? 'filter' : 'filters'} applied</span>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-[var(--radius)] p-1 text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><X size={18} /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {pickerField('Select Offers', 'offer', offers, draft.filters.offer, (v) => setFilter('offer', v), 'Type to search offers…')}
            {pickerField('Select Partners', 'partner', partners, draft.filters.partner, (v) => setFilter('partner', v), 'Type to search partners…')}
            {pickerField('Select Advertisers', 'advertiser', advertisers, draft.filters.advertiser, (v) => setFilter('advertiser', v), 'Type to search advertisers…')}
            <div className="min-w-0">
              <span className="label">Select Timezone</span>
              <TimeZoneSelect zone={draftZone} selectClassName="!w-full min-w-0 max-w-full" />
              <p className="mt-1 text-tiny text-fg-muted">The report's time zone: its date range, days and the times shown.</p>
            </div>
            {pickerField('Select Smart Links', 'smartLink', smartLinks, draft.filters.smartLink, (v) => setFilter('smartLink', v), 'Type to search smart links…')}
            {pickerField('Select Country', 'country', countries, draft.filters.country, (v) => setFilter('country', v), 'Type to search countries…')}
            <div className="min-w-0">
              <label className="label" htmlFor={`${uid}-cstatus`}>Conversion Status</label>
              <select id={`${uid}-cstatus`} className="input" value={draft.filters.conversionStatus}
                onChange={(e) => setFilter('conversionStatus', e.target.value)}>
                <option value="">All clicks</option>
                {conversionStatuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <h3 className="mt-6 text-body font-semibold text-fg">Click Filters:</h3>
          <div className="mt-3 space-y-4">
            <div>
              <label className="label" htmlFor={`${uid}-clickids`}>Click IDs (comma separated)</label>
              <textarea id={`${uid}-clickids`} className="input min-h-[5rem] resize-y font-mono text-small" placeholder="Enter Click IDs…"
                value={draft.clickIdsText} aria-invalid={!!errors.clickIds} aria-describedby={`${uid}-clickids-err`}
                onChange={(e) => setDraft((d) => ({ ...d, clickIdsText: e.target.value }))} />
              {errors.clickIds && <p id={`${uid}-clickids-err`} className="mt-1 text-tiny text-danger-text" role="alert">{errors.clickIds}</p>}
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-ip`}>IP Address</label>
              <input id={`${uid}-ip`} className="input" placeholder="Enter IP Address" value={draft.ipText} inputMode="text" autoComplete="off"
                aria-invalid={!!errors.ip} aria-describedby={`${uid}-ip-err`}
                onChange={(e) => setDraft((d) => ({ ...d, ipText: e.target.value }))} />
              {errors.ip && <p id={`${uid}-ip-err`} className="mt-1 text-tiny text-danger-text" role="alert">{errors.ip}</p>}
            </div>
            {/* Exact values from the click URL — clicks recorded before these were captured have none. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
              {CAPTURED_INPUTS.map(({ key, label, placeholder, mono }) => (
                <div key={key} className="min-w-0">
                  <label className="label" htmlFor={`${uid}-${key}`}>{label}</label>
                  <input id={`${uid}-${key}`} className={`input${mono ? ' font-mono text-small' : ''}`} placeholder={placeholder} autoComplete="off"
                    value={draft.filters[key]} aria-invalid={!!errors[key]} aria-describedby={`${uid}-${key}-err`}
                    onChange={(e) => setFilter(key, e.target.value)} />
                  {errors[key] && <p id={`${uid}-${key}-err`} className="mt-1 text-tiny text-danger-text" role="alert">{errors[key]}</p>}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`${uid}-device`}>Device</label>
                <select id={`${uid}-device`} className="input !w-auto min-w-[10rem] max-w-full" value={draft.filters.device}
                  onChange={(e) => setFilter('device', e.target.value)}>
                  <option value="">All Devices</option>
                  {devices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-visibility`}>Visibility</label>
                <select id={`${uid}-visibility`} className="input !w-auto min-w-[10rem] max-w-full" value={draft.filters.visibility}
                  title="Unique = first click from this visitor on the offer; Duplicate = a repeat click"
                  onChange={(e) => setFilter('visibility', e.target.value as Visibility)}>
                  {VISIBILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-body font-semibold text-fg" id={`${uid}-fields`}>Click Report Fields</h3>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-small text-fg-secondary">
                  <input type="checkbox" className="chk" checked={allState === 'all'}
                    ref={(el) => { if (el) el.indeterminate = allState === 'some'; }}
                    onChange={() => setDraft((d) => ({ ...d, fields: setAllFields(d.fields, matching, allState !== 'all') }))}
                    aria-label={fieldQuery ? 'Select all matching fields' : 'Select all fields'} />
                  Select All
                </label>
                <button type="button" onClick={() => setFieldsOpen((o) => !o)} aria-expanded={fieldsOpen} aria-controls={`${uid}-fields-body`}
                  aria-label={fieldsOpen ? 'Collapse Click Report Fields' : 'Expand Click Report Fields'}
                  className="rounded-[var(--radius)] p-1 text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {fieldsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
            </div>
            {groupMode && <p className="mt-1 text-tiny text-fg-muted">Fields apply to the individual-clicks table; Group By shows its own columns.</p>}
            {fieldsOpen && (
              <div id={`${uid}-fields-body`} className="mt-3">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" aria-hidden />
                  <input ref={fieldSearchRef} className="input !pl-9" placeholder="Search fields…" aria-label="Search fields"
                    value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} />
                </div>
                {errors.fields && <p className="mt-2 text-tiny text-danger-text" role="alert">{errors.fields}</p>}
                {matching.length === 0 ? <p className="mt-3 text-small text-fg-muted">No fields match “{fieldQuery}”.</p> : (
                  <>
                    {tracked.length === 0
                      ? <p className="mt-3 text-small text-fg-muted">No tracked fields match “{fieldQuery}”.</p>
                      : <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-labelledby={`${uid}-fields`}>{tracked.map(fieldRow)}</ul>}
                    {untracked.length > 0 && (
                      <div className="mt-4 border-t border-dashed border-border pt-3">
                        <button type="button" onClick={() => setShowUntracked((o) => !o)} aria-expanded={showUntracked} aria-controls={`${uid}-untracked`}
                          className="inline-flex items-center gap-1.5 rounded-[var(--radius)] text-small font-medium text-fg-secondary hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                          {showUntracked ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                          {untrackedToggleLabel(untracked.length, showUntracked)}
                        </button>
                        {showUntracked && (
                          <div id={`${uid}-untracked`}>
                            <p className="mt-1 text-tiny text-fg-muted">Nothing in Tracker captures these yet — hover a field to see what it needs.</p>
                            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Untracked fields">{untracked.map(fieldRow)}</ul>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border px-5 py-4 sm:px-6">
          <button type="button" className="btn-primary justify-center disabled:cursor-not-allowed disabled:opacity-50" onClick={apply}
            disabled={!valid} title={!valid ? 'Fix the highlighted fields first' : undefined}>Apply Filters</button>
          <button type="button" className="btn-ghost justify-center border border-border" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Overlay>
  );
}

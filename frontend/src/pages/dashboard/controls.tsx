/** Dashboard controls: date range button, pill tabs, range select, chart-type toggle, customize menu. */
import { BarChart3, Calendar, Check, ChevronDown, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { MenuPopover } from '../../shared-components/primitives/ui';
import { RANGE_PRESETS, rangeText, type DashboardRange, type RangePreset } from './range';
import { SECTIONS, type Visible } from './prefs';

/** Real dates of the window in the zone, plus a preset menu with a check on the selected one. */
export function DateRangeButton({ range, onChange, zoneShort }: {
  range: DashboardRange; onChange: (p: RangePreset) => void; zoneShort: string;
}) {
  return (
    <MenuPopover
      ariaLabel={`Date range: ${rangeText(range)} (${zoneShort}). Change range`}
      triggerClassName="btn-ghost !rounded-full !px-3"
      width="w-56"
      button={<>
        <Calendar size={15} aria-hidden className="text-fg-secondary" />
        <span className="tabular-nums">{rangeText(range)}</span>
        <span className="rounded bg-subtle px-1.5 text-tiny font-semibold text-fg-secondary">{zoneShort}</span>
        <ChevronDown size={14} aria-hidden className="text-fg-muted" />
      </>}
    >
      {({ close }) => RANGE_PRESETS.map((p) => (
        <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === range.preset}
          onClick={() => { onChange(p.id); close(); }}
          className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-left text-small font-medium text-fg transition-colors duration-fast hover:bg-subtle">
          <span className="grid w-4 place-items-center" aria-hidden>{p.id === range.preset && <Check size={15} className="text-accent-text" />}</span>
          {p.label}
        </button>
      ))}
    </MenuPopover>
  );
}

/** Pill tabs — a single choice shown as rounded pills (sets the server orderBy / plotted metric). */
export function PillTabs<T extends string>({ options, value, onChange, ariaLabel }: {
  options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(o.id)}
            className={`rounded-full px-3 py-1 text-tiny font-semibold transition-colors duration-fast ${
              on ? 'bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent/30' : 'text-fg-secondary hover:bg-subtle hover:text-fg'
            }`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact range select for a single card. */
export function RangeSelect({ value, onChange, label }: { value: RangePreset; onChange: (p: RangePreset) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as RangePreset)}
      className="input !w-auto !py-1 !pl-2.5 !pr-8 text-tiny">
      {RANGE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
    </select>
  );
}

/** Area ⇄ bar. */
export function ChartKindToggle({ value, onChange }: { value: 'area' | 'bar'; onChange: (v: 'area' | 'bar') => void }) {
  const btn = (kind: 'area' | 'bar', label: string, Icon: typeof TrendingUp) => (
    <button type="button" aria-pressed={value === kind} aria-label={label} title={label} onClick={() => onChange(kind)}
      className={`grid h-8 w-8 place-items-center rounded-full transition-colors duration-fast ${
        value === kind ? 'bg-surface text-fg shadow-sm ring-1 ring-inset ring-border' : 'text-fg-secondary hover:text-fg'
      }`}>
      <Icon size={15} aria-hidden />
    </button>
  );
  return (
    <div role="group" aria-label="Chart type" className="flex gap-0.5 rounded-full border border-border bg-subtle p-0.5">
      {btn('area', 'Area chart', TrendingUp)}
      {btn('bar', 'Bar chart', BarChart3)}
    </div>
  );
}

/** "Customize cards" — which sections are shown (remembered). */
export function CustomizeCards({ visible, onChange }: { visible: Visible; onChange: (v: Visible) => void }) {
  return (
    <MenuPopover
      ariaLabel="Customize cards"
      triggerClassName="btn-ghost !px-2.5"
      width="w-60"
      button={<><SlidersHorizontal size={16} aria-hidden /><span className="hidden sm:inline">Customize</span></>}
    >
      {() => (
        <>
          <p className="px-3 pb-1 pt-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted">Show cards</p>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" role="menuitemcheckbox" aria-checked={visible[s.id]}
              onClick={() => onChange({ ...visible, [s.id]: !visible[s.id] })}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-left text-small font-medium text-fg transition-colors duration-fast hover:bg-subtle">
              <span aria-hidden className={`grid h-4 w-4 place-items-center rounded border ${visible[s.id] ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-surface'}`}>
                {visible[s.id] && <Check size={12} />}
              </span>
              {s.label}
            </button>
          ))}
        </>
      )}
    </MenuPopover>
  );
}

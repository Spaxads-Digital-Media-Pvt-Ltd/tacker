/** Shared building blocks reused across the Offers › Custom Settings Add/Edit forms (Revenue &
 * Payout / Throttle Rates / Landing Pages) — "Effective Between" (Always On vs Set Specific Period),
 * "Partners Conditions" (Apply to all Partners toggle + dual-list), and a reduced "Targeting" step
 * (Countries/Devices/OS/Browsers as free-text values — see data/offerCustomSettings.ts for why this
 * app doesn't build the reference's full geo/ISP/device lookup tree). */
import { Field } from './ui';
import { DualListPicker, type PickerOption } from './DualListPicker';
import { splitValues, joinValues, type Targeting } from '../data/offerCustomSettings';

export function YesNoToggle({ value, onChange, labels = ['No', 'Yes'] }: { value: boolean; onChange: (v: boolean) => void; labels?: [string, string] }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`flex w-24 items-center rounded-full border border-border p-0.5 text-tiny font-medium ${value ? 'justify-end bg-accent-subtle text-accent-text' : 'justify-start text-fg-secondary'}`}>
      <span className="rounded-full bg-surface px-2 py-1 shadow-sm">{value ? labels[1] : labels[0]}</span>
    </button>
  );
}

export function StatusToggle({ value, onChange }: { value: 'active' | 'inactive'; onChange: (v: 'active' | 'inactive') => void }) {
  return (
    <div className="flex max-w-md overflow-hidden rounded-[var(--radius)] border border-border">
      {(['active', 'inactive'] as const).map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-small capitalize ${value === s ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>
          <span className={`h-2 w-2 rounded-full ${s === 'active' ? 'bg-success' : 'bg-warning'}`} />{s}
        </button>
      ))}
    </div>
  );
}

export function EffectiveBetweenField({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const specific = from !== '' || to !== '';
  return (
    <Field label="Effective Between *">
      <div className="max-w-md overflow-hidden rounded-[var(--radius)] border border-border">
        <div className="flex">
          {(['Always On', 'Set Specific Period'] as const).map((label, i) => (
            <button key={label} type="button" onClick={() => onChange(i === 0 ? '' : from, i === 0 ? '' : to)}
              className={`flex-1 py-2 text-small ${(i === 0) === !specific ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>{label}</button>
          ))}
        </div>
      </div>
      {specific && (
        <div className="mt-2 flex max-w-md gap-2">
          <input type="datetime-local" className="input" value={from} onChange={(e) => onChange(e.target.value, to)} />
          <input type="datetime-local" className="input" value={to} onChange={(e) => onChange(from, e.target.value)} />
        </div>
      )}
    </Field>
  );
}

export function PartnersConditionField({ applyAll, onApplyAll, options, selected, onChange }: {
  applyAll: boolean; onApplyAll: (v: boolean) => void; options: PickerOption[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-3 text-h3 font-medium text-fg">Partners Conditions</p>
      <Field label="Apply to all Partners"><YesNoToggle value={applyAll} onChange={onApplyAll} /></Field>
      {!applyAll && (
        <div className="ml-3 mt-3 max-w-2xl border-l-2 border-border pl-4">
          <Field label="Partners *"><DualListPicker options={options} selected={selected} onChange={onChange} /></Field>
        </div>
      )}
    </div>
  );
}

export function TargetingStep({ value, onChange }: { value: Targeting; onChange: (t: Targeting) => void }) {
  const row = (label: string, key: keyof Targeting, placeholder: string) => (
    <Field label={label}>
      <textarea className="input min-h-[70px]" placeholder={placeholder}
        value={joinValues(value[key])}
        onChange={(e) => onChange({ ...value, [key]: splitValues(e.target.value) })} />
    </Field>
  );
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-tiny text-fg-secondary">Leave a field blank to match any value. Enter one or more values separated by commas or new lines.</p>
      {row('Countries', 'countries', 'e.g. US, CA, GB')}
      {row('Devices', 'devices', 'e.g. mobile, desktop, tablet')}
      {row('OS', 'os', 'e.g. iOS, Android, Windows')}
      {row('Browsers', 'browsers', 'e.g. Chrome, Safari, Firefox')}
    </div>
  );
}

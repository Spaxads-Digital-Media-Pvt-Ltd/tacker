/**
 * Radio cards (role="radiogroup", roving tabindex, ←/→/↑/↓/Home/End move and select).
 *  - tone="status"  (StatusChoice): the selected card uses the success treatment — status picks only.
 *  - tone="neutral" (any other option picker): the selected card uses the accent treatment.
 * Option `tone` adds a status dot. Values are passed through untouched.
 */
import { useRef, type KeyboardEvent } from 'react';
import { nextChoiceIndex } from './formLogic';

export type ChoiceDot = 'success' | 'warning' | 'danger' | 'neutral';
export interface ChoiceOption<T extends string = string> { value: T; label: string; tone?: ChoiceDot }

// Warning dot uses --warning-text: plain --warning is 2.15:1 on white, under the 3:1 UI minimum.
const DOT: Record<ChoiceDot, string> = { success: 'bg-success', warning: 'bg-warning-text', danger: 'bg-danger', neutral: 'bg-fg-muted' };

export interface ChoiceCardsProps<T extends string> {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledby?: string;
  disabled?: boolean;
  className?: string;
}

export function ChoiceCards<T extends string>({
  options, value, onChange, ariaLabel, ariaLabelledby, disabled, className = '', tone = 'neutral',
}: ChoiceCardsProps<T> & { tone?: 'status' | 'neutral' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : 0;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = nextChoiceIndex(e.key, i, options.length);
    if (next === null) return;
    e.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  const on = tone === 'status'
    ? 'border-success bg-success-bg text-success-text ring-1 ring-inset ring-success'
    : 'border-accent-text bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent-text';
  return (
    // 4+ options: a 2×2 grid below sm so labels never truncate at 390 px.
    <div role="radiogroup" aria-label={ariaLabel} aria-labelledby={ariaLabelledby} className={`${options.length > 3 ? 'grid grid-cols-2 sm:flex' : 'flex'} gap-2 ${className}`}>
      {options.map((o, i) => {
        const checked = i === selected;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={checked}
            tabIndex={i === tabStop ? 0 : -1} disabled={disabled} onClick={() => onChange(o.value)} onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex min-h-[44px] min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-[var(--radius)] border px-3 py-2 text-small font-medium transition-colors duration-fast disabled:pointer-events-none disabled:opacity-50 ${
              checked ? on : 'border-border-strong bg-surface text-fg hover:border-fg-secondary'}`}>
            {o.tone && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[o.tone]}`} />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Status picker: ChoiceCards with the success selection (e.g. Active / Paused / Draft). */
export function StatusChoice<T extends string>(props: ChoiceCardsProps<T>) {
  return <ChoiceCards {...props} tone="status" />;
}

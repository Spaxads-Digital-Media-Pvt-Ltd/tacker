/**
 * Toggle row: a bordered row with the label, "No"/"Yes" and a switch. Presentational — the page owns
 * the value (`checked`) and the change handler. Off: --border-strong track, on-accent knob.
 * On: --success track, surface knob (F1b: an on-accent knob on success was 1.92:1 in Dark).
 */
import { useId } from 'react';
import { HelpHint } from '../panels/HelpHint';

export function ToggleRow({ label, checked, onChange, disabled = false, hint, hintIcon = false }: {
  label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean;
  /** Existing help copy: feeds Field help; with `hintIcon` also the (?) tooltip beside the label. */
  hint?: string; hintIcon?: boolean;
}) {
  const labelId = useId();
  return (
    <div data-help-label={label} data-help={hint}
      className="flex min-h-[48px] items-center gap-3 rounded-[var(--radius)] border border-border-strong bg-surface px-3.5 py-2.5">
      <span className="flex flex-1 items-center text-small text-fg"><span id={labelId}>{label}</span>{hintIcon && hint && <HelpHint text={hint} />}</span>
      <span aria-hidden className="text-small text-fg-secondary">{checked ? 'Yes' : 'No'}</span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelId} disabled={disabled} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-fast disabled:opacity-50 ${checked ? 'bg-success' : 'bg-border-strong'}`}>
        <span aria-hidden className={`h-4 w-4 rounded-full shadow-sm transition-transform duration-fast motion-reduce:transition-none ${checked ? 'translate-x-4 bg-surface' : 'bg-on-accent'}`} />
      </button>
    </div>
  );
}

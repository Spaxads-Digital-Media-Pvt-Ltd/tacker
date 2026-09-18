import { HelpCircle } from 'lucide-react';

/**
 * Small "(?)" affordance next to a field label. Hover or keyboard-focus reveals a short,
 * token-styled tooltip. Pure CSS show/hide (no portal) — the tooltip opens downward into the
 * form card's own padding, so it never needs to escape an overflow context.
 */
export function HelpHint({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex translate-y-px align-middle">
      <button
        type="button"
        tabIndex={0}
        aria-label={text}
        className="grid h-3.5 w-3.5 cursor-help place-items-center rounded-full text-fg-muted transition-colors hover:text-fg-secondary focus-visible:text-fg-secondary focus-visible:outline-none"
      >
        <HelpCircle size={13} aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-max max-w-[220px] -translate-x-1/2 rounded-[var(--radius)] border border-border bg-elevated px-2.5 py-1.5 text-tiny font-normal normal-case leading-snug text-fg-secondary shadow-elevated group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

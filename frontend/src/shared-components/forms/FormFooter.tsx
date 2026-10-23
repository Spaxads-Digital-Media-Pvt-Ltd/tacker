/**
 * Sticky form footer. Left: "Step X of Y" (wizards) and the unsaved-changes note — only on pages that
 * already guard unsaved changes. Right: the page's own Cancel/Back controls and the primary button,
 * whose label, disabled and busy state the page passes unchanged. Below md the buttons go full
 * width; below sm the primary shows `shortLabel` (the full label stays its accessible name).
 * `-bottom-12` cancels AppShell main's pb-12 so the bar sits flush with the viewport edge.
 */
import { isValidElement, type ReactNode } from 'react';

export interface FooterPrimary {
  label: ReactNode;
  /** Shown below sm (e.g. "Next" for "Next: Tracking & controls"). */
  shortLabel?: ReactNode;
  type?: 'submit' | 'button';
  form?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function FormFooter({ stepText, unsavedNote, cancel, primary }: {
  stepText?: string;
  unsavedNote?: string;
  /** The page's existing Cancel / Back element(s). */
  cancel?: ReactNode;
  /** A FooterPrimary, or the page's own primary element. */
  primary: FooterPrimary | ReactNode;
}) {
  const p = primary && typeof primary === 'object' && !isValidElement(primary) && 'label' in (primary as object) ? (primary as FooterPrimary) : null;
  return (
    <div className="sticky -bottom-12 z-20 -mx-4 mt-6 flex flex-col gap-3 border-t border-border bg-surface px-4 py-3 sm:-mx-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:-mx-8 lg:px-8">
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-secondary">
        {stepText && <span className="font-medium text-fg">{stepText}</span>}
        {stepText && unsavedNote && <span aria-hidden className="h-1 w-1 rounded-full bg-fg-muted" />}
        {unsavedNote && <span>{unsavedNote}</span>}
      </p>
      <div className="flex w-full gap-2 md:w-auto [&>*]:flex-1 md:[&>*]:flex-none">
        {cancel}
        {p ? (
          <button type={p.type ?? 'submit'} form={p.form} onClick={p.onClick} disabled={p.disabled} aria-busy={p.busy || undefined} className="btn-primary">
            {p.shortLabel
              ? <><span aria-hidden className="sm:hidden">{p.shortLabel}</span><span className="sr-only sm:not-sr-only">{p.label}</span></>
              : p.label}
          </button>
        ) : (primary as ReactNode)}
      </div>
    </div>
  );
}

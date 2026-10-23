/**
 * Form page layout (Concept 05): the form card with its header (step caption, title, required note)
 * and, optionally, the 336 px aside — FieldHelpPanel + UpNextCard — at ≥ lg. Below lg the field help
 * becomes a collapsed "Field help" disclosure under the card header and Up next moves below the card.
 * No aside → the card is centred and wider (max 880 px) so it never leaves half the page empty.
 * Wizards pass `layout` explicitly so the card width never changes between steps: "aside" keeps the
 * 336 px column reserved even on a step with nothing to show; "centered" puts Up next below the card.
 * Presentational only: the page keeps its own <form>, fields, validation and submit.
 */
import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { FormSection } from './FormSection';
import { FieldHelpPanel, type FieldHelpProps } from './FieldHelpPanel';

export function FormLayout({ caption, title, requiredNote, help, upNext, layout, stepper = false, children }: {
  /** e.g. "Step 1 · Setup" (shown in caps). */
  caption?: ReactNode;
  title?: ReactNode;
  /** The page's existing required-fields note. */
  requiredNote?: ReactNode;
  /** Field help (existing hints only); omit when the form has none. */
  help?: FieldHelpProps;
  /** Wizards only — an <UpNextCard>. */
  upNext?: ReactNode;
  /** Fixed per wizard (see above). Omitted: aside when there's help or Up next, else centred. */
  layout?: 'aside' | 'centered';
  /** The page has the sticky Stepper above: the aside sticks below it instead of near the top. */
  stepper?: boolean;
  children: ReactNode;
}) {
  const hasAside = (layout ?? (help || upNext ? 'aside' : 'centered')) === 'aside';
  return (
    <div data-form-layout className={hasAside ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_336px] lg:items-start' : 'mx-auto w-full max-w-[880px]'}>
      <div className="min-w-0 space-y-6">
        <section className="card !p-5 sm:!p-7">
          {(caption || title || requiredNote) && (
            <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                {caption && <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-text">{caption}</p>}
                {title && <h2 className="mt-1 text-h2 font-bold tracking-tight text-fg">{title}</h2>}
              </div>
              {requiredNote && <p className="text-tiny text-fg-muted">{requiredNote}</p>}
            </header>
          )}
          {help && (
            <div className="mb-6 lg:hidden">
              <FormSection id="field-help" collapsible
                title={<span className="flex items-center gap-2.5"><span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-accent-subtle text-accent-text"><Lightbulb size={15} /></span>Field help</span>}>
                <FieldHelpPanel {...help} bare />
              </FormSection>
            </div>
          )}
          {children}
        </section>
        {upNext && <div className={hasAside ? 'lg:hidden' : undefined}>{upNext}</div>}
      </div>
      {hasAside && (
        <aside className={`hidden space-y-4 lg:sticky lg:block ${stepper ? 'lg:top-28' : 'lg:top-6'}`}>
          {/* empty:-mb-4 — nothing focused yet: no gap above Up next. */}
          {help && <FieldHelpPanel {...help} className="empty:-mb-4" />}
          {upNext}
        </aside>
      )}
    </div>
  );
}

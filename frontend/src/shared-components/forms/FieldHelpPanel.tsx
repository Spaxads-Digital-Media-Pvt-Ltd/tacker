/**
 * "Field help" — the focused field's label as the title and its EXISTING hint as the body. Fields
 * expose `data-help-label` / `data-help` (primitives/ui Field); this listens to focusin within its
 * FormLayout (`[data-form-layout]`). With nothing focused it shows the step's existing description
 * (`fallback`) or nothing. `tips` only ever come from existing copy. The wrapper is aria-live.
 */
import { useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { helpFromTarget, type HelpInfo } from './formLogic';

/** Empty state on a wizard step with hints but no Up next (the step title is the heading). */
export const FIELD_HELP_EMPTY = 'Select a field to see its help.';

export interface FieldHelpProps {
  fallback?: { title?: string; body?: string };
  tips?: readonly string[];
}

export function FieldHelpPanel({ fallback, tips, className = '', bare = false }: FieldHelpProps & {
  className?: string;
  /** Inside FormLayout's "Field help" disclosure (below lg): no card, no header row. */
  bare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<HelpInfo | null>(null);

  useEffect(() => {
    const root: HTMLElement | Document = ref.current?.closest<HTMLElement>('[data-form-layout]') ?? document;
    const onFocusIn = (e: Event) => setInfo(helpFromTarget(e.target));
    const onFocusOut = (e: Event) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (!next || !(root === document ? document.body : (root as HTMLElement)).contains(next)) setInfo(null);
    };
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => { root.removeEventListener('focusin', onFocusIn); root.removeEventListener('focusout', onFocusOut); };
  }, []);

  const title = info?.label ?? fallback?.title;
  const body = info ? info.help : fallback?.body;
  const hasContent = Boolean(title || body || tips?.length);
  return (
    <div ref={ref} aria-live="polite" className={className}>
      {hasContent && (
        <section className={bare ? '' : 'card !p-5'}>
          {!bare && (
            <p className="mb-3 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-accent-subtle text-accent-text"><Lightbulb size={16} /></span>
              Field help
            </p>
          )}
          {title && <h3 className="text-h3 font-semibold text-fg">{title}</h3>}
          {body && <p className="mt-2 text-small leading-relaxed text-fg-secondary">{body}</p>}
          {tips?.length ? (
            <ul className="mt-4 space-y-2 border-t border-border pt-4 text-small text-fg-secondary">
              {tips.map((t) => (
                <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-text" />{t}</li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

export interface StepGroup { label: string; steps: number[] }

/**
 * Step indicator for the create wizards (Concept 05): a sticky card of pill chips — done = check,
 * current = accent chip (number in an inverted circle), upcoming = subtle chip. Optional `groups`
 * show the steps by phase, each with a caps caption ("1 of 3" in the current phase, "n steps"
 * otherwise) and thin dividers; optional `labels` are shorter display names (`steps` values are
 * unchanged). Progress only — unless the page already let users jump between steps: then it passes
 * `onStepClick` (same handler as its old step buttons) and each chip is a button. From md the chips
 * spread across the card with thin connectors (phases grow by their step count); below md the row
 * scrolls sideways (the next chip peeks past the edge), the current chip is kept in view, and the
 * row is a keyboard stop (arrow keys scroll it) only while it actually scrolls. The card shares the
 * FormLayout container width (`form-width`).
 */
export function Stepper({ steps, current, groups, labels, onStepClick }: {
  steps: readonly string[]; current: number; groups?: StepGroup[]; labels?: string[];
  /** Only for pages whose step headers were already clickable; no new navigation. */
  onStepClick?: (index: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return undefined;
    const measure = () => setScrollable(box.scrollWidth > box.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const box = scroller.current;
    const el = currentRef.current;
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < b.left + 12 || r.right > b.right - 12) box.scrollLeft += r.left - b.left - 12;
  }, [current]);

  // One chip, plus (unless it ends its row) a thin connector item that takes the free space, so ≥ md
  // the chips spread across the card width; below md the connectors hide and the row scrolls. Inside a
  // phase (`capped`) a connector stops at 160 px, so a phase that wraps onto its own row stays compact.
  const chip = (i: number, endsRow: boolean, capped = false) => {
    const isCurrent = i === current;
    const done = i < current;
    const body = (
      <>
        <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-tiny font-semibold tabular-nums ${
          isCurrent ? 'bg-on-accent text-accent' : done ? 'bg-accent-subtle text-accent-text' : 'bg-surface text-fg-secondary ring-1 ring-inset ring-border'}`}>
          {done ? <Check size={13} strokeWidth={3} /> : i + 1}
        </span>
        <span className="whitespace-nowrap">{labels?.[i] ?? steps[i]}</span>
        {done && <span className="sr-only"> (done)</span>}
      </>
    );
    const chipClass = `flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-small font-medium ${isCurrent ? 'bg-accent text-on-accent' : 'bg-subtle text-fg-secondary'}`;
    return [
      <li key={i} ref={isCurrent ? currentRef : undefined} aria-current={!onStepClick && isCurrent ? 'step' : undefined} className="flex shrink-0">
        {onStepClick ? (
          <button type="button" aria-current={isCurrent ? 'step' : undefined} onClick={() => onStepClick(i)}
            className={`${chipClass} transition-colors duration-fast ${isCurrent ? '' : 'hover:bg-border hover:text-fg'}`}>{body}</button>
        ) : <span className={chipClass}>{body}</span>}
      </li>,
      !endsRow && (
        <li key={`${i}-to`} aria-hidden role="presentation"
          className={`mx-2 hidden h-px min-w-3 flex-1 self-center md:block ${capped ? 'max-w-40' : ''} ${done ? 'bg-accent-text/40' : 'bg-border'}`} />
      ),
    ];
  };

  return (
    <nav aria-label="Progress" className="sticky -top-5 z-20 -mx-4 mb-6 bg-page px-4 pb-3 pt-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {/* form-width: the same container as the FormLayout card (index.css). */}
      <div ref={scroller} role="group" aria-label="Steps" tabIndex={scrollable ? 0 : undefined}
        className="card form-width overflow-x-auto !p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max min-w-full gap-1 px-3 py-3 md:w-auto md:flex-wrap md:gap-x-0 md:gap-y-3 md:px-5 md:py-4">
          {groups ? groups.map((g, gi) => {
            const pos = g.steps.indexOf(current);
            return (
              // Each phase grows in proportion to its step count; the dividers stay between phases.
              <div key={g.label} role="group" aria-label={g.label} style={{ flexGrow: g.steps.length }}
                className={`flex shrink-0 flex-col gap-2 ${gi > 0 ? 'border-l border-border pl-2 md:pl-5' : ''} ${gi < groups.length - 1 ? 'pr-2 md:pr-5' : ''}`}>
                <p className={`flex items-baseline gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider ${pos >= 0 ? 'text-accent-text' : 'text-fg-secondary'}`}>
                  {g.label}
                  <span className="text-tiny font-normal normal-case tracking-normal text-fg-muted">
                    {pos >= 0 ? `${pos + 1} of ${g.steps.length}` : `${g.steps.length} ${g.steps.length === 1 ? 'step' : 'steps'}`}
                  </span>
                </p>
                <ol start={(g.steps[0] ?? 0) + 1} className="flex gap-1 md:gap-0">{g.steps.map((s, k) => chip(s, k === g.steps.length - 1, true))}</ol>
              </div>
            );
          }) : <ol className="flex flex-1 gap-1 md:gap-0">{steps.map((_, i) => chip(i, i === steps.length - 1))}</ol>}
        </div>
      </div>
    </nav>
  );
}

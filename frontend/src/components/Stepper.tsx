import { Check } from 'lucide-react';

/** Numbered step indicator for multi-step create wizards (Everflow-style): a full-width, sticky
 *  strip — each label on a single line above its circle, a horizontal rule running through the
 *  circles whose completed portion fills with the accent. Sticks to the top of the scroll area so
 *  it stays visible while the form below it scrolls. Render it as a direct child of the page's
 *  scroll container (outside any `max-w-*` wrapper) so it spans the full width. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  return (
    <div className="sticky -top-4 z-20 -mx-4 mb-6 border-b border-border bg-page px-4 pb-4 pt-4">
      <div className="relative">
        {/* connector rule, sitting at the circles' vertical centre, behind them */}
        <div className="absolute inset-x-[6%] bottom-[15px] h-0.5 bg-border">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <ol className="relative flex items-end justify-between gap-2">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s} className="flex flex-1 flex-col items-center gap-2">
                <span className={`whitespace-nowrap text-center text-[11px] font-medium leading-none ${active ? 'text-fg' : 'text-fg-muted'}`}>{s}</span>
                <span
                  className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-tiny font-semibold transition-colors ${
                    done
                      ? 'border-accent bg-accent text-white'
                      : active
                      ? 'border-accent bg-accent text-white shadow-[0_0_0_4px_rgb(var(--accent-subtle))]'
                      : 'border-border bg-page text-fg-muted'
                  }`}
                >
                  {done ? <Check size={15} strokeWidth={3} /> : i + 1}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

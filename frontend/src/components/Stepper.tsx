import { Check } from 'lucide-react';

/** Numbered step indicator for multi-step Add/Create wizards (Everflow-style): labels above,
 * circles edge-to-edge below, connected by a horizontal line whose completed portion fills with accent. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  const cols = `repeat(${steps.length}, minmax(0, 1fr))`;

  return (
    <div className="relative mb-8 w-full">
      {/* Labels — first left, last right, middle centred */}
      <div className="grid w-full gap-1" style={{ gridTemplateColumns: cols }}>
        {steps.map((s, i) => {
          const active = i === current;
          const align = i === 0 ? 'text-left' : i === steps.length - 1 ? 'text-right' : 'text-center';
          return (
            <span
              key={s}
              className={`line-clamp-2 min-h-[2.25rem] text-tiny font-medium leading-tight ${align} ${active ? 'text-fg' : 'text-fg-muted'}`}
            >
              {s}
            </span>
          );
        })}
      </div>

      {/* Circles + connector — spans full width, line runs centre-to-centre of first/last circle */}
      <div className="relative mt-2 h-8 w-full">
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-border"
          style={{ left: '1rem', right: '1rem' }}
        />
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-accent transition-all duration-300"
          style={{ left: '1rem', width: `calc((100% - 2rem) * ${progress / 100})` }}
        />
        <div className="relative flex h-full w-full items-center justify-between">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <div
                key={s}
                className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-tiny font-semibold transition-colors ${
                  done
                    ? 'border-accent bg-accent text-white'
                    : active
                    ? 'border-accent bg-page text-accent-text shadow-[0_0_0_4px_rgb(var(--accent-subtle))]'
                    : 'border-border bg-page text-fg-muted'
                }`}
              >
                {done ? <Check size={15} strokeWidth={3} /> : i + 1}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

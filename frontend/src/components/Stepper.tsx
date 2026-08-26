import { Check } from 'lucide-react';

/** Numbered step indicator for multi-step Add/Create wizards (Everflow-style): labels above,
 * circles below, connected by a horizontal line whose completed portion fills with the accent. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  return (
    <div className="relative mb-8">
      <div className="flex justify-between">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={s} className="flex flex-1 flex-col items-center gap-2 px-1 last:flex-none">
              <span className={`line-clamp-2 flex h-9 items-center text-center text-tiny font-medium leading-tight ${active ? 'text-fg' : 'text-fg-muted'}`}>{s}</span>
              <div
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
            </div>
          );
        })}
      </div>
      <div className="absolute left-4 right-4 top-[60px] h-px bg-border">
        <div className="h-px bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

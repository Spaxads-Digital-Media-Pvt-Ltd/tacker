/** Wizards only: the next step's number and name, an optional one-line description, a Required badge. */
export function UpNextCard({ number, name, description, required = false }: {
  number: number; name: string; description?: string; required?: boolean;
}) {
  return (
    <section aria-label="Up next" className="card !p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">Up next</p>
      <div className="mt-2.5 flex items-start gap-3">
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border-strong text-tiny font-semibold tabular-nums text-fg-secondary">{number}</span>
        <div className="min-w-0 flex-1">
          <p className="text-small font-medium text-fg"><span className="sr-only">Step {number}: </span>{name}</p>
          {description && <p className="mt-0.5 text-tiny text-fg-secondary">{description}</p>}
        </div>
        {required && <span className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-tiny font-semibold text-warning-text">Required</span>}
      </div>
    </section>
  );
}

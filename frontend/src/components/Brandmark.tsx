import { BRAND } from '../config/branding';

/** The wordmark. Uses the single branding constant so a rename propagates everywhere (spec §14). */
export function Brandmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-fg text-white shadow-sm">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
        </svg>
      </span>
      {!compact && <span className="font-display text-lg font-bold tracking-tight text-fg">{BRAND.name}</span>}
    </div>
  );
}

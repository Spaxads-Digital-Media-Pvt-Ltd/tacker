import { BRAND } from '../config/branding';

/** The wordmark. Uses the single branding constant so a rename propagates everywhere (spec §14). */
export function Brandmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#14B8A6] to-[#0D9488] text-white shadow-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
        </svg>
      </span>
      {!compact && <span className="text-lg font-bold tracking-tight">{BRAND.name}</span>}
    </div>
  );
}

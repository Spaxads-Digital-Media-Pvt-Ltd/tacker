import { useState } from 'react';
import { BRAND } from '../../config/branding';
import { useHostBrand } from '../../lib/hostBrand';

/**
 * The wordmark. Uses the single branding constant so a rename propagates everywhere (spec §14). With
 * the network's own logo (O12, Control Center › Platform) that image takes its place — the mark's box
 * when compact, up to a wordmark's width when not — and the default comes back if it fails to load.
 */
export function Brandmark({ compact = false, logoUrl: own = null }: { compact?: boolean; logoUrl?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  // White-label: a network's dashboard domain shows its own name and logo.
  const host = useHostBrand();
  const logoUrl = own ?? host?.logoUrl ?? null;
  const name = host?.brandName ?? BRAND.name;
  if (logoUrl && failed !== logoUrl) {
    return (
      <img src={logoUrl} alt={name} onError={() => setFailed(logoUrl)}
        className={compact ? 'h-9 w-9 rounded-xl object-contain' : 'h-9 max-w-[11rem] object-contain object-left'} />
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
        </svg>
      </span>
      {!compact && <span className="text-lg font-bold tracking-tight">{name}</span>}
    </div>
  );
}

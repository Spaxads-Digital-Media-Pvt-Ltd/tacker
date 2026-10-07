import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

/**
 * Offer thumbnail cell for tables (Offers list, Advertiser → Offers, Partner → Visibility). Shows
 * the offer's `thumbnailUrl` (an uploaded image in Supabase Storage or a pasted http(s) URL — the
 * backend only stores http(s)), and falls back to the placeholder icon when there is none or the
 * image fails to load. Lazy-loaded, and no referrer is sent to third-party image hosts.
 */
export function OfferThumbnail({ url, name, size = 'sm' }: { url?: string | null; name: string; size?: 'sm' | 'lg' }) {
  // Remember which URL failed, so a row whose thumbnail later changes gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = size === 'lg' ? 'h-16 w-16' : 'h-9 w-9';
  if (!url || failedUrl === url) {
    return (
      <div className={`grid ${box} place-items-center rounded-[var(--radius)] border border-border bg-page text-fg-muted`} title="No thumbnail">
        <ImageIcon size={size === 'lg' ? 20 : 15} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`${name} thumbnail`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`${box} rounded-[var(--radius)] border border-border bg-page object-cover`}
      onError={() => setFailedUrl(url)}
    />
  );
}

import { useMemo } from 'react';
import { qrMatrix } from '../../lib/qr';

/**
 * A QR code as an SVG (lib/qr.ts — no dependency): dark modules on white with the standard 4-module
 * quiet zone, always black-on-white whatever the theme (scanners need the contrast). `size` in px.
 */
export function QrCode({ value, size = 180, title }: { value: string; size?: number; title?: string }) {
  const { path, n } = useMemo(() => {
    const m = qrMatrix(value);
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
    return { path: d, n: m.length + 8 };
  }, [value]);
  return (
    <svg role="img" aria-label={title ?? 'QR code'} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" className="rounded-[var(--radius)] border border-border">
      {title && <title>{title}</title>}
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

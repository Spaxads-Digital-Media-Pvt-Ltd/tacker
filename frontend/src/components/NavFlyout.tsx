import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Icon } from './icons';
import type { NavEntry } from './nav';

/** Everflow-style rail flyout: click a grouped nav icon, a panel opens beside the rail listing
 * every feature under that section (bold label + a compact one-line description), themed to this
 * app's own light design tokens rather than the reference's own visuals. Always anchored near the
 * top of the rail (not tracking the clicked icon's own position) — matches the reference, which
 * opens every flyout in the same spot regardless of which icon triggered it. Items with a real
 * page navigate; items with none render identically but inert, with a "Not available yet"
 * tooltip — same honesty convention used everywhere else in this app. */
export function NavFlyout({ entry, onClose }: { entry: NavEntry; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const Ic = Icon[entry.icon];
  const items = entry.flyout ?? [];

  const itemClass = 'block px-5 py-3 text-left transition-colors hover:bg-accent-subtle';
  const body = (it: { label: string; description: string }) => (
    <>
      <p className="text-body font-semibold text-fg">{it.label}</p>
      <p className="mt-0.5 text-tiny text-fg-secondary">{it.description}</p>
    </>
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed left-[68px] top-3 z-50 max-h-[calc(100vh-24px)] w-[340px] animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated shadow-card"
    >
      <div className="sticky top-0 flex items-center gap-2.5 border-b border-border bg-elevated px-5 py-4">
        <span className="text-accent-text"><Ic /></span>
        <h2 className="flex-1 text-h3 font-semibold tracking-tight text-fg">{entry.label}</h2>
        <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={17} /></button>
      </div>
      <div className="py-2">
        {items.map((it) =>
          it.to ? (
            <Link key={it.label} to={it.to} onClick={onClose} className={itemClass}>{body(it)}</Link>
          ) : (
            <button key={it.label} type="button" title="Not available yet" onClick={onClose} className={`w-full ${itemClass}`}>{body(it)}</button>
          ),
        )}
      </div>
    </div>,
    document.body,
  );
}

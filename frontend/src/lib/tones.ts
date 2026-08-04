/**
 * Shared decorative tone palette — used for stat-card icon chips, chart series and any small
 * multi-color accent that isn't a semantic status (see ui.tsx Badge for status colors, which use
 * the success/warning/danger/info tokens instead). Kept in one place so new UI reaches for the same
 * five hues instead of inventing another gradient combo per page.
 */
export type Tone = 'teal' | 'blue' | 'amber' | 'violet' | 'rose';

export const TONE_CHIP: Record<Tone, string> = {
  teal: 'bg-teal-50 text-teal-700',
  blue: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-700',
  violet: 'bg-violet-50 text-violet-700',
  rose: 'bg-rose-50 text-rose-700',
};

/** Thin left-border accent to pair with TONE_CHIP on a card. */
export const TONE_BORDER: Record<Tone, string> = {
  teal: 'border-l-teal-500',
  blue: 'border-l-sky-500',
  amber: 'border-l-amber-500',
  violet: 'border-l-violet-500',
  rose: 'border-l-rose-500',
};

/** Solid hex per tone — for inline SVG (sparklines/charts) where Tailwind classes don't apply. */
export const TONE_HEX: Record<Tone, string> = {
  teal: '#0d9488',
  blue: '#0284c7',
  amber: '#d97706',
  violet: '#7c3aed',
  rose: '#e11d48',
};

/** @type {import('tailwindcss').Config} */
// Every color/type utility below reads a CSS variable defined in src/index.css (Section 0 tokens).
// rgb(var(--token) / <alpha-value>) keeps Tailwind's opacity modifiers working (e.g. bg-accent/25).
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

/* =============================================================================
 * RESPONSIVE / BREAKPOINT STRATEGY  (Section: Responsive — established Step 1)
 * Screens are Tailwind defaults: sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536.
 * Device priority: laptop/desktop is the primary workspace; tablet is a real
 * secondary surface; mobile is monitoring + light interaction, not full data entry.
 *
 *   Mobile      < md (768)     · sidebar = off-canvas drawer (hamburger in header)
 *                              · single-column; forms stack fully
 *                              · wide tables: horizontal scroll (never reflow to cards)
 *   Tablet      md–lg (768–1024)· sidebar = persistent COLLAPSED icon rail (not a
 *                                drawer); still expandable via the rail toggle
 *                              · 2-col where content supports it (KPI row of 3, etc.)
 *                              · tables still scroll, but more is visible
 *   Laptop      lg–xl (1024–1280+) · the baseline design target — most screens are
 *                                designed/tested here; rail collapsed by default
 *   Large desktop xl+ (1280+)  · dashboard opens its 3-col KPI layout; content should
 *                                USE the width (3-col grids) rather than stretch thin.
 *                                Narrow single-purpose pages (forms) keep a sane
 *                                max-width via `.card` + page container, not full-bleed.
 *
 * Wide-table rule: keep horizontal scroll on narrow viewports (matches Stripe /
 * Segment / Airtable / Notion data grids). Polish the scroll — sticky header,
 * sticky first (identifier) column, edge-fade affordance — in the shared <Table>
 * (components/ui.tsx), not per page.
 * ============================================================================= */

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Accent — theme-swappable (Section 6).
        accent: {
          DEFAULT: rgb('--accent'),
          hover: rgb('--accent-hover'),
          subtle: rgb('--accent-subtle'),
          text: rgb('--accent-text'),
        },
        // Semantic / status — CONSTANT across every theme (green=+, red=-, amber=pending, blue=info).
        success: { DEFAULT: rgb('--success'), bg: rgb('--success-bg'), text: rgb('--success-text') },
        danger: { DEFAULT: rgb('--danger'), bg: rgb('--danger-bg'), text: rgb('--danger-text') },
        warning: { DEFAULT: rgb('--warning'), bg: rgb('--warning-bg'), text: rgb('--warning-text') },
        info: { DEFAULT: rgb('--info'), bg: rgb('--info-bg'), text: rgb('--info-text') },
        // Neutral / surface (light).
        page: rgb('--bg-page'),
        surface: rgb('--bg-surface'),
        elevated: rgb('--bg-elevated'),
        border: rgb('--border'),
        // Foreground text ramp.
        fg: {
          DEFAULT: rgb('--text-primary'),
          secondary: rgb('--text-secondary'),
          muted: rgb('--text-muted'),
        },
        // Legacy brand.* — aliased to the accent via CSS vars so old components recolor with the theme.
        brand: {
          50: rgb('--brand-50'), 100: rgb('--brand-100'), 300: rgb('--brand-300'),
          400: rgb('--brand-400'), 500: rgb('--brand-500'), 600: rgb('--brand-600'), 700: rgb('--brand-700'),
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        h1: ['var(--fs-h1)', { lineHeight: '1.3', fontWeight: '600' }],
        h2: ['var(--fs-h2)', { lineHeight: '1.3', fontWeight: '600' }],
        h3: ['var(--fs-h3)', { lineHeight: '1.4', fontWeight: '500' }],
        body: ['var(--fs-body)', { lineHeight: '1.5' }],
        small: ['var(--fs-small)', { lineHeight: '1.5' }],
        tiny: ['var(--fs-tiny)', { lineHeight: '1.5' }],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        card: 'var(--radius-card)',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 12px rgb(0 0 0 / 0.04)',
        // Themeable — resolves to --shadow-elevated (index.css), which the .dark block deepens.
        elevated: 'var(--shadow-elevated)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-in': 'fade-in 0.3s ease-out both' },
    },
  },
  plugins: [],
};

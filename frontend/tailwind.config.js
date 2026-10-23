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
        chart: rgb('--chart'),
        // Text/icons on accent fills.
        'on-accent': rgb('--text-on-accent'),
        // Metric hues — charts, sparklines, icon chips, tone borders. Translucent variants are
        // opacity modifiers (bg-metric-revenue/5), never new variables. Not for text in light mode.
        metric: {
          revenue: rgb('--metric-revenue'),
          payout: rgb('--metric-payout'),
          margin: rgb('--metric-margin'),
          clicks: rgb('--metric-clicks'),
          conversions: rgb('--metric-conversions'),
        },
        header: { DEFAULT: rgb('--header-bg'), fg: rgb('--header-fg') },
        table: { head: rgb('--table-head-bg'), 'head-fg': rgb('--table-head-fg'), 'row-hover': rgb('--table-row-hover') },
        sidebar: {
          DEFAULT: rgb('--sidebar-bg'),
          // `text` / `active` used to point at undefined vars; now mapped to the real sidebar tokens.
          text: rgb('--sidebar-fg'),
          muted: rgb('--text-muted'),
          active: rgb('--sidebar-active-bg'),
          fg: rgb('--sidebar-fg'),
          'fg-strong': rgb('--sidebar-fg-strong'),
          'fg-muted': rgb('--sidebar-fg-muted'),
          'active-bg': rgb('--sidebar-active-bg'),
          'hover-bg': rgb('--sidebar-hover-bg'),
          accent: rgb('--sidebar-accent'),
          border: rgb('--sidebar-border'),
          // Fixed 28% — the active-row ring (alpha baked in, so no opacity modifier).
          ring: 'rgb(var(--sidebar-active-ring) / 0.28)',
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
        subtle: rgb('--bg-subtle'),
        border: {
          DEFAULT: rgb('--border'),
          strong: rgb('--border-strong'),
          // Fixed 60% — card/control hover border (alpha baked in, so no opacity modifier).
          hover: 'rgb(var(--border-hover) / 0.6)',
        },
        // Foreground text ramp.
        fg: {
          DEFAULT: rgb('--text-primary'),
          secondary: rgb('--text-secondary'),
          muted: rgb('--text-muted'),
        },
        // Legacy brand.* — aliased to the accent via CSS vars so old components recolor with the theme.
        brand: {
          // brand.DEFAULT = the bright brand teal (indicators, icons, charts, focus). Not for text in light mode.
          DEFAULT: rgb('--brand'),
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
        nav: 'var(--radius-nav)',
        shell: 'var(--radius-shell)',
      },
      // Themeable — resolve to --shadow-* (index.css), which the .dark block deepens.
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        elevated: 'var(--shadow-elevated)',
      },
      // Motion tokens (index.css). Named so Tailwind's stock ease-out / ease-in-out stay unchanged.
      // prefers-reduced-motion is handled globally in index.css.
      // Stacking for portaled layers — one source of truth. Shell layers stay below (header 40,
      // drawer / flyout / rail popovers 50, rail tooltip 60); `overlay` is every dimmed Modal /
      // ConfirmDialog layer; `popover` is any menu or picker that may open inside one.
      zIndex: {
        overlay: '100',
        popover: '110',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
      },
      transitionTimingFunction: {
        'out-token': 'var(--ease-out)',
        'in-out-token': 'var(--ease-in-out)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(-12px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'slide-in-left': { from: { opacity: '0', transform: 'translateX(-32px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'unwrap': { from: { opacity: '0', transform: 'perspective(1000px) rotateX(-90deg)', transformOrigin: 'top' }, to: { opacity: '1', transform: 'perspective(1000px) rotateX(0deg)', transformOrigin: 'top' } },
        'draw-line': { to: { strokeDashoffset: '0' } },
        // Auth pages (Batch 9 storyboard, Figma 30:8427). Transform / opacity only, 150–300 ms each;
        // prefers-reduced-motion zeroes them globally (index.css) and call sites add motion-reduce:animate-none.
        'rise-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        // The card never starts hidden — inputs are usable (and autofill visible) from the first frame.
        'card-in': { from: { opacity: '0.6', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        // Stands in for a path draw (stroke-dashoffset isn't transform/opacity): the curve rises in.
        'curve-in': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
        'dot-pop': { from: { opacity: '0', transform: 'scale(0.4)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'ring-pulse': { from: { opacity: '0.6', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(1.6)' } },
        'error-in': { from: { opacity: '0', transform: 'translateY(-4px)' }, to: { opacity: '1', transform: 'none' } },
        'shake-x': {
          '0%, 100%': { transform: 'translateX(0)' }, '20%': { transform: 'translateX(-6px)' }, '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' }, '80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-left': 'slide-in-left 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'unwrap': 'unwrap 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'draw-line': 'draw-line 1.5s ease-out forwards',
        'rise-in': 'rise-in 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'card-in': 'card-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'curve-in': 'curve-in 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'dot-pop': 'dot-pop 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'ring-pulse': 'ring-pulse 300ms ease-out both',
        'error-in': 'error-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'shake-x': 'shake-x 300ms ease-in-out',
      },
    },
  },
  plugins: [],
};

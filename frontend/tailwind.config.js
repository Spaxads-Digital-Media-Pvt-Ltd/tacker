/** @type {import('tailwindcss').Config} */
// Every color/type utility below reads a CSS variable defined in src/index.css (Section 0 tokens).
// rgb(var(--token) / <alpha-value>) keeps Tailwind's opacity modifiers working (e.g. bg-accent/25).
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

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
        subtle: rgb('--bg-subtle'),
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
        display: ['var(--font-display)'],
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
        card: '0 1px 2px rgb(28 25 23 / 0.04), 0 8px 24px -4px rgb(28 25 23 / 0.06)',
        elevated: '0 12px 32px -6px rgb(28 25 23 / 0.16), 0 2px 6px rgb(28 25 23 / 0.06)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { 'fade-in': 'fade-in 0.3s ease-out both' },
    },
  },
  plugins: [],
};

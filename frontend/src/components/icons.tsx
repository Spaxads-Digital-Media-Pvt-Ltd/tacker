/** Minimal inline icon set (no icon dependency). Stroke icons, currentColor. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const Icon = {
  dashboard: (p: P) => (
    <svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  offers: (p: P) => (
    <svg {...base(p)}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
  ),
  users: (p: P) => (
    <svg {...base(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" /><path d="M18 14.2a5.5 5.5 0 0 1 2.5 4.6" /></svg>
  ),
  building: (p: P) => (
    <svg {...base(p)}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></svg>
  ),
  chart: (p: P) => (
    <svg {...base(p)}><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></svg>
  ),
  wallet: (p: P) => (
    <svg {...base(p)}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><circle cx="16.5" cy="14" r="1" /></svg>
  ),
  key: (p: P) => (
    <svg {...base(p)}><circle cx="8" cy="8" r="4" /><path d="M11 11l8 8M16 16l2-2M14 14l2-2" /></svg>
  ),
  spark: (p: P) => (
    <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>
  ),
  sun: (p: P) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>
  ),
  moon: (p: P) => (
    <svg {...base(p)}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>
  ),
  logout: (p: P) => (
    <svg {...base(p)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 12H3m0 0 3-3m-3 3 3 3" /></svg>
  ),
  alert: (p: P) => (
    <svg {...base(p)}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
  ),
  manager: (p: P) => (
    <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0 1 14 0" /><path d="M8 22h8" /></svg>
  ),
  analytics: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 17l5-6 4 3 7-9" />
      <circle cx="9" cy="11" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="13" cy="14" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20" cy="5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  ),
  marketplace: (p: P) => (
    <svg {...base(p)}>
      <path d="M3 9l1.2-5.2A1 1 0 0 1 5.2 3h13.6a1 1 0 0 1 1 .8L21 9" />
      <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
      <path d="M3 9a2.2 2.2 0 0 0 4.3.7A2.2 2.2 0 0 0 9.5 11a2.2 2.2 0 0 0 2.2-1.3A2.2 2.2 0 0 0 14 11a2.2 2.2 0 0 0 2.2-1.3A2.2 2.2 0 0 0 21 9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  ),
  send: (p: P) => (
    <svg {...base(p)}><path d="M21 3 3 10.5l7.5 3L13.5 21 21 3Z" /><path d="M10.5 13.5 21 3" /></svg>
  ),
  gem: (p: P) => (
    <svg {...base(p)}><path d="M6 3h12l3 5-9 13L3 8Z" /><path d="M3 8h18M9 3l3 5-3 13M15 3l-3 5 3 13" /></svg>
  ),
  pulse: (p: P) => (
    <svg {...base(p)}><path d="M3 12h4l2-7 4 14 2-7h6" /></svg>
  ),
  automation: (p: P) => (
    <svg {...base(p)}>
      <rect x="3" y="4" width="7" height="7" rx="1.5" /><circle cx="17.5" cy="7.5" r="3.5" />
      <path d="M6.5 11v3a2 2 0 0 0 2 2h6M17.5 11v6" /><rect x="14" y="17" width="7" height="4" rx="1" />
    </svg>
  ),
  investigator: (p: P) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="12" height="16" rx="1.5" /><path d="M6.5 7.5h5M6.5 11h5M6.5 14.5h2.5" />
      <circle cx="17" cy="17" r="3.5" /><path d="M19.6 19.6 22 22" />
    </svg>
  ),
  controlCenter: (p: P) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
    </svg>
  ),
};

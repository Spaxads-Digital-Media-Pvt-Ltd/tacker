/**
 * Theme system (Section 6). Six accent themes; switching one swaps ONLY the four --accent* CSS
 * variables — semantic (success/danger/warning/info) and neutral/surface tokens are identical in
 * every theme (Section 0 rule). Theme A (Ledger Teal) is the default. Values are "R G B" triples to
 * match the token format in index.css. Add a seventh theme by appending one entry here — nothing else.
 */
export type ThemeId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface Theme {
  id: ThemeId;
  name: string;
  isDefault?: boolean;
  accent: string;   // --accent
  hover: string;    // --accent-hover
  subtle: string;   // --accent-subtle
  text: string;     // --accent-text
}

export const THEMES: Theme[] = [
  { id: 'A', name: 'Ledger Teal', isDefault: true, accent: '13 148 136', hover: '15 118 110', subtle: '240 253 250', text: '19 78 74' },
  { id: 'B', name: 'Ink Cobalt', accent: '30 64 175', hover: '30 58 138', subtle: '239 246 255', text: '30 58 138' },
  { id: 'C', name: 'Terracotta', accent: '194 65 12', hover: '154 52 18', subtle: '255 247 237', text: '154 52 18' },
  { id: 'D', name: 'Plum', accent: '109 40 217', hover: '91 33 182', subtle: '250 245 255', text: '91 33 182' },
  { id: 'E', name: 'Forest', accent: '21 128 61', hover: '22 101 52', subtle: '240 253 244', text: '22 101 52' },
  { id: 'F', name: 'Slate Ink', accent: '51 65 85', hover: '30 41 59', subtle: '248 250 252', text: '30 41 59' },
];

export const DEFAULT_THEME: ThemeId = 'A';

const byId = (id: string | null | undefined): Theme =>
  THEMES.find((t) => t.id === id) ?? (THEMES[0] as Theme);

/** Apply a theme by swapping the four accent CSS variables on :root (instant, no reload). */
export function applyTheme(id: string | null | undefined): void {
  const t = byId(id);
  const root = document.documentElement;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-hover', t.hover);
  root.style.setProperty('--accent-subtle', t.subtle);
  root.style.setProperty('--accent-text', t.text);
}

/** Read the saved theme from the persisted session (for apply-before-paint), else default. */
export function themeFromStoredSession(): ThemeId {
  try {
    const raw = localStorage.getItem('tracker.session.v2');
    if (!raw) return DEFAULT_THEME;
    const id = (JSON.parse(raw) as { theme?: string }).theme;
    return byId(id).id;
  } catch {
    return DEFAULT_THEME;
  }
}

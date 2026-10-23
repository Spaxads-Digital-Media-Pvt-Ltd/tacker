/**
 * Light/dark theme.
 *
 * First visit (nothing stored): follows the OS `prefers-color-scheme`, live — flipping the OS
 * setting flips the app. Once the user presses the toggle, that explicit choice is stored and
 * wins from then on (the OS setting is no longer followed).
 *
 * The mechanism is entirely CSS: this toggles a `dark` class on <html>, and index.css
 * redefines the tokens under `.dark`. No component needs to know about the theme.
 *
 * Keep readStoredTheme() in sync with the no-flash inline script in index.html, which applies
 * the same logic before the bundle loads.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tracker-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The user's explicit, persisted choice — null when none is stored or storage is unavailable. */
function readStoredChoice(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

/** The OS preference (light when matchMedia is unavailable). */
function systemTheme(): Theme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The theme to show: the explicit stored choice, else the OS preference. */
export function readStoredTheme(): Theme {
  return readStoredChoice() ?? systemTheme();
}

/** Add/remove the `dark` class on <html> so index.css + Tailwind pick up the theme. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  // True once the user has chosen (stored, or pressed the toggle) — the OS is then ignored.
  const [explicit, setExplicit] = useState(() => readStoredChoice() !== null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // No explicit choice yet → track the OS setting live.
  useEffect(() => {
    if (explicit) return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setThemeState(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [explicit]);

  // Only an explicit choice is written to storage.
  const setTheme = useCallback((t: Theme) => {
    setExplicit(true);
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* private mode / storage disabled — theme still applies for this session */
    }
  }, []);
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}

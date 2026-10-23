/**
 * Sun/moon icon button that flips light ⇄ dark. Persistence handled by ThemeProvider.
 * 44px round target; both icons are stacked and cross-fade (instant under reduced motion).
 * The label names the theme the button switches TO.
 */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeContext';

const ICON = 'absolute transition-[opacity,transform] duration-base ease-out-token motion-reduce:transition-none';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-subtle text-header-fg transition-colors duration-fast hover:border-border-hover hover:bg-surface"
    >
      <Sun size={18} aria-hidden className={`${ICON} ${dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0'}`} />
      <Moon size={18} aria-hidden className={`${ICON} ${dark ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
    </button>
  );
}

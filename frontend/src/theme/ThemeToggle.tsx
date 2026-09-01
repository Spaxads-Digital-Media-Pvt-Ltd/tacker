/** Sun/moon icon button that flips light ⇄ dark. Persistence handled by ThemeProvider. */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeContext';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-fg-secondary transition-colors hover:bg-accent-subtle hover:text-fg"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

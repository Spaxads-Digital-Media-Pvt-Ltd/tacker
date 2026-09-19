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
      className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-white shadow-[0_2px_4px_rgba(0,0,0,0.5)] ring-1 ring-white/20 transition-colors hover:bg-black/30 hover:text-white"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

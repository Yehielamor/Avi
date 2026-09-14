import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'craftmind.theme';

function apply(theme: Theme): void {
  const root = document.documentElement;
  // "system" מסיר את התכונה כדי שה-media query ב-theme.css יכריע.
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* מצב פרטי */
    }
  }, [theme]);

  const options: Array<{ value: Theme; icon: typeof Sun; label: string }> = [
    { value: 'light', icon: Sun, label: 'בהיר' },
    { value: 'dark', icon: Moon, label: 'כהה' },
    { value: 'system', icon: Monitor, label: 'לפי המערכת' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="ערכת נושא"
      className="inline-flex items-center gap-0.5 rounded-(--radius-md) bg-surface-sunken p-0.5"
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'grid size-7 place-items-center rounded-(--radius-sm) transition-colors duration-(--duration-fast)',
            theme === value
              ? 'bg-surface-raised text-fg shadow-xs'
              : 'text-fg-subtle hover:text-fg-muted',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

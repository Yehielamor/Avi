import { Link, useRouterState } from '@tanstack/react-router';
import {
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth';
import { cn, initials } from '@/lib/utils';
import type { UserRole } from '@/lib/schemas';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** מי רואה את הפריט. ההרשאה עצמה נאכפת בשרת — כאן רק הסתרה. */
  roles?: UserRole[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'סקירה', icon: LayoutDashboard },
  { to: '/tasks', label: 'משימות', icon: ClipboardList },
  { to: '/customers', label: 'לקוחות', icon: Users },
  { to: '/inventory', label: 'מלאי', icon: Boxes, roles: ['OWNER', 'MANAGER'] },
  { to: '/invoices', label: 'חשבוניות', icon: FileText, roles: ['OWNER', 'MANAGER'] },
  { to: '/settings', label: 'הגדרות', icon: Settings, roles: ['OWNER'] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const visible = NAV.filter((n) => !n.roles || can(...n.roles));

  return (
    <div className="min-h-dvh bg-canvas">
      {/* דילוג לתוכן — הדבר הראשון ב-tab order. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-(--radius-md) focus:bg-accent focus:px-4 focus:py-2 focus:text-fg-on-accent"
      >
        דלג לתוכן הראשי
      </a>

      {/* ---- סרגל צד, דסקטופ. ב-RTL הוא בצד ימין; `start` מטפל בזה. ---- */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-border bg-surface lg:flex">
        <Brand />
        <Nav items={visible} pathname={pathname} />
        <UserFooter name={session?.user.name ?? ''} role={session?.user.role} onLogout={logout} />
      </aside>

      {/* ---- מגירה, מובייל ---- */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="סגירת התפריט"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 start-0 flex w-64 flex-col border-e border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between pe-2">
              <Brand />
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="סגירה">
                <X aria-hidden />
              </Button>
            </div>
            <Nav items={visible} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <UserFooter name={session?.user.name ?? ''} role={session?.user.role} onLogout={logout} />
          </aside>
        </div>
      ) : null}

      {/* ---- אזור התוכן ---- */}
      <div className="lg:ps-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="פתיחת התפריט"
          >
            <Menu aria-hidden />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{session?.tenant.name}</p>
          </div>
          <ThemeToggle />
        </header>

        <main id="main" className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2.5 px-5">
      <div className="grid size-7 place-items-center rounded-(--radius-sm) bg-accent text-fg-on-accent">
        <span className="text-xs font-bold">CM</span>
      </div>
      <span className="text-sm font-semibold tracking-tight text-fg">CraftMind</span>
    </div>
  );
}

function Nav({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="ניווט ראשי">
      {items.map(({ to, label, icon: Icon }) => {
        const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-(--radius-md) px-3 py-2.5 text-sm transition-colors duration-(--duration-fast)',
              active
                ? 'bg-accent-subtle font-medium text-accent'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'בעל/ת העסק',
  MANAGER: 'ניהול',
  FIELD: 'צוות שטח',
};

function UserFooter({
  name,
  role,
  onLogout,
}: {
  name: string;
  role?: UserRole;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-border p-3">
      <div
        className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunken text-2xs font-semibold text-fg-muted"
        aria-hidden
      >
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-fg">{name}</p>
        {role ? <p className="truncate text-2xs text-fg-subtle">{ROLE_LABEL[role]}</p> : null}
      </div>
      <Button variant="ghost" size="icon" onClick={onLogout} aria-label="התנתקות" className="size-8">
        <LogOut className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

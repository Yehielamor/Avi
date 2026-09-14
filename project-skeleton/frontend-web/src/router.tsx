import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { TasksPage } from '@/features/tasks/tasks-page';
import { tokenStore } from '@/lib/api';

/**
 * ניתוב מבוסס-קוד ולא מבוסס-קבצים: אין קובץ `routeTree.gen.ts`
 * מיוצר שצריך לזכור לוודא שהוא מסונכרן, והמסלולים גלויים במקום אחד.
 */

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

/**
 * מסלול הגנה. חשוב: זו הסתרת UI בלבד — הטוקן נבדק בשרת בכל בקשה.
 * בדיקת קליינט לעולם אינה גבול אבטחה.
 */
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  beforeLoad: ({ location }) => {
    if (!tokenStore.get()) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  component: DashboardPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/tasks',
  component: TasksPage,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/tasks/$taskId',
  component: () => <div className="text-sm text-fg-muted">מסך פרטי משימה — בבנייה</div>,
});

const placeholder = (title: string) =>
  createRoute({
    getParentRoute: () => protectedRoute,
    path: `/${title}`,
    component: () => <div className="text-sm text-fg-muted">מסך {title} — בבנייה</div>,
  });

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([
    indexRoute,
    tasksRoute,
    taskDetailRoute,
    placeholder('customers'),
    placeholder('inventory'),
    placeholder('invoices'),
    placeholder('settings'),
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

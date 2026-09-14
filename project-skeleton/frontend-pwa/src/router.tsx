import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { JobDetailPage } from '@/features/jobs/job-detail-page';
import { MyJobsPage } from '@/features/jobs/my-jobs-page';
import { tokenStore } from '@/lib/api';

/**
 * שלושה מסלולים, ותו לא. כל מסך נוסף כאן הוא מסך שטכנאי צריך
 * לנווט דרכו בזמן שהוא עומד מול לוח חשמל.
 */

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    if (tokenStore.get()) throw redirect({ to: '/' });
  },
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search['redirect'] === 'string' ? search['redirect'] : undefined,
  }),
  component: LoginPage,
});

/**
 * מסלול הגנה. זו הסתרת UI בלבד — הטוקן נבדק בשרת בכל בקשה, ובדיקת
 * קליינט לעולם אינה גבול אבטחה.
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

const myJobsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  component: MyJobsPage,
});

const jobDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/jobs/$taskId',
  component: JobDetailPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([myJobsRoute, jobDetailRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

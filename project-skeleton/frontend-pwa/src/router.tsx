import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { MyDayPage } from '@/features/day/my-day-page';
import { JobDetailPage } from '@/features/jobs/job-detail-page';
import { MyJobsPage } from '@/features/jobs/my-jobs-page';
import { tokenStore } from '@/lib/api';

/**
 * ארבעה מסלולים, ותו לא. כל מסך נוסף כאן הוא מסך שטכנאי צריך
 * לנווט דרכו בזמן שהוא עומד מול לוח חשמל. הבית הוא "היום שלי" —
 * לאן נוסעים עכשיו — ו"כל המשימות" הוא מסך משני.
 */

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's contract: beforeLoad throws the Redirect (a Response, not an Error)
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
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's contract: beforeLoad throws the Redirect (a Response, not an Error)
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const myDayRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  component: MyDayPage,
});

const myJobsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/jobs',
  component: MyJobsPage,
});

const jobDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/jobs/$taskId',
  component: JobDetailPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([myDayRoute, myJobsRoute, jobDetailRoute]),
]);

// BASE_URL = '/field/' בפרודקשן (vite.config.ts). בלי זה כל קישור פנימי יוצא מהאפליקציה.
export const router = createRouter({ routeTree, defaultPreload: false, basepath: import.meta.env.BASE_URL });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

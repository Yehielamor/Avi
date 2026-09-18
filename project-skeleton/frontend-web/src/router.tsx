import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/features/auth/login-page';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { TasksPage } from '@/features/tasks/tasks-page';
import { TaskDetailPage } from '@/features/tasks/task-detail-page';
import { CustomersPage } from '@/features/customers/customers-page';
import { CustomerDetailPage } from '@/features/customers/customer-detail-page';
import { InventoryPage } from '@/features/inventory/inventory-page';
import { PriceListPage } from '@/features/price-list/price-list-page';
import { InvoicesPage } from '@/features/invoices/invoices-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { TaskStatusPage } from '@/features/public/task-status-page';
import { BookingPage } from '@/features/public/booking-page';
import { MaintenancePage } from '@/features/maintenance/maintenance-page';
import { tokenStore } from '@/lib/api';

/**
 * ניתוב מבוסס-קוד ולא מבוסס-קבצים: אין קובץ `routeTree.gen.ts`
 * מיוצר שצריך לזכור לוודא שהוא מסונכרן, והמסלולים גלויים במקום אחד.
 */

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // משתמש עם טוקן שמנווט ל-/login מוחזר פנימה. בלי זה, "חזור"
  // בדפדפן אחרי התחברות מציג שוב את מסך ההתחברות.
  beforeLoad: () => {
    if (tokenStore.get()) throw redirect({ to: '/' });
  },
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search['redirect'] === 'string' ? search['redirect'] : undefined,
  }),
  component: LoginPage,
});

/**
 * מסלול הגנה. חשוב: זו הסתרת UI בלבד — הטוקן נבדק בשרת בכל בקשה.
 * בדיקת קליינט לעולם אינה גבול אבטחה.
 */
/**
 * הקמת עסק חדש. ציבורי במכוון — אין עדיין טננט ואין משתמש, וזו כל
 * הנקודה של המסך. הוא *לא* יושב תחת protectedRoute.
 */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

/**
 * דפים שהלקוח של העסק פותח מקישור ב-WhatsApp. בלי התחברות ובלי מעטפת
 * האפליקציה: הטוקן בכתובת הוא ההרשאה, והשרת מאמת אותו בכל בקשה.
 */
const publicStatusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/s/$token',
  component: TaskStatusPage,
});

const publicBookingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/b/$token',
  component: BookingPage,
});

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
  component: TaskDetailPage,
});

const customersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/customers',
  component: CustomersPage,
});

const customerDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/customers/$customerId',
  component: CustomerDetailPage,
});

const priceListRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/price-list',
  component: PriceListPage,
});

const maintenanceRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/maintenance',
  component: MaintenancePage,
});

const inventoryRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/inventory',
  component: InventoryPage,
});

const invoicesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/invoices',
  component: InvoicesPage,
});

// `/settings` ו-`/settings/$tab` שניהם מגיעים ל-SettingsPage: ה-callback
// של Google מפנה ל-/settings/integrations, ובלי הנתיב השני זה 404.
const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/settings',
  component: SettingsPage,
});

const settingsTabRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/settings/$tab',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardingRoute,
  publicStatusRoute,
  publicBookingRoute,
  protectedRoute.addChildren([
    indexRoute,
    tasksRoute,
    taskDetailRoute,
    customersRoute,
    customerDetailRoute,
    inventoryRoute,
    maintenanceRoute,
    priceListRoute,
    invoicesRoute,
    settingsRoute,
    settingsTabRoute,
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

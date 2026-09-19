import { ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth';
import { EmailForwardingCard } from './email-forwarding-card';
import { IntegrationsPanel } from './integrations-panel';
import { ProfilePanel } from './profile-panel';

export function SettingsPage() {
  const { can } = useAuth();

  // הסתרת UI בלבד. ההרשאה נאכפת בשרת ב-RolesGuard על כל בקשה
  // (`@Roles(UserRole.OWNER)` על נתיבי ה-integrations) — מי שינווט
  // לכאן ידנית יקבל 403 מהשרת, לא מכאן.
  if (!can('OWNER')) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={ShieldAlert}
          title="אין הרשאה למסך ההגדרות"
          description="הגדרות העסק, החיבורים והמשתמשים זמינות לבעלים בלבד. לשינוי הרשאה יש לפנות לבעלי החשבון."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="הגדרות" description="פרופיל, מראה וחיבורים חיצוניים" />

      <Tabs defaultValue="profile">
        <TabsList aria-label="קטגוריות הגדרות">
          <TabsTrigger value="profile" className="min-h-11">פרופיל</TabsTrigger>
          <TabsTrigger value="appearance" className="min-h-11">מראה</TabsTrigger>
          <TabsTrigger value="integrations" className="min-h-11">חיבורים</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfilePanel />
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>ערכת נושא</CardTitle>
              <CardDescription>
                ההעדפה נשמרת בדפדפן הזה בלבד. "לפי המערכת" עוקב אחרי הגדרת מערכת ההפעלה.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeToggle />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-5">
          <EmailForwardingCard />
          <IntegrationsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { validateEnv, type AppEnv } from './config/env.schema';
import { AlertingModule } from './alerting/alerting.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LlmModule } from './llm/llm.module';
import { QueueModule } from './queue/queue.module';
import { WorkerModule } from './queue/worker.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RolesGuard } from './common/guards/roles.guard';
import { THROTTLERS } from './common/throttle';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';

import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { JobTypeTemplatesModule } from './modules/job-type-templates/job-type-templates.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { IntakeModule } from './modules/intake/intake.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { CommsModule } from './modules/comms/comms.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PriceListModule } from './modules/price-list/price-list.module';
import { PublicLinksModule } from './modules/public-links/public-links.module';
import { TaskStatusModule } from './modules/task-status/task-status.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { ReportsModule } from './modules/reports/reports.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';

/**
 * ה-root module של המונוליט המודולרי.
 *
 * כל "אג'נט" מהארכיטקטורה הוא מודול NestJS עצמאי תחת src/modules/.
 * מודולים מתקשרים דרך אירועים, לא בקריאה ישירה — ראו
 * docs/01-architecture.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // האפליקציה לא עולה עם קונפיגורציה לא תקינה. ראו
      // docs/10-audit-findings.md#I1 — ה-fallback הישן ל-JWT_SECRET
      // אפשר לקונטיינר פרודקשן לעלות עם סוד שנמצא בעץ המקור.
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req, res) => {
            const existing = req.headers['x-request-id'];
            const id = typeof existing === 'string' ? existing : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // סודות לא מגיעים ללוגים. הרשימה כוללת את ה-sessionSecret
          // של onboarding, שעבר ב-query string.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.passwordHash',
              'req.body.sessionSecret',
              'req.query.sessionSecret',
              'req.query.code',
              'req.query.state',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/v1/health') ?? false,
          },
        },
      }),
    }),

    // הגבלת קצב גלובלית. קודם לא הייתה בכלל: /auth/login היה פתוח
    // ל-credential stuffing בלתי מוגבל, ו-bcrypt בעלות 12 הפך את זה
    // גם ל-DoS זול על ה-CPU. ראו docs/10-audit-findings.md#I2.
    // השמות מוגדרים ב-common/throttle.ts: דריסה per-route חייבת להשתמש בהם.
    ThrottlerModule.forRoot(THROTTLERS),

    EventEmitterModule.forRoot(),

    AlertingModule,
    DatabaseModule,
    HealthModule,
    LlmModule,
    QueueModule,

    TenantsModule,
    AuthModule,
    CustomersModule,
    DashboardModule,
    TasksModule,
    JobTypeTemplatesModule,
    SchedulingModule,
    IntegrationsModule,
    IntakeModule,
    InvoicingModule,
    CommsModule,
    InventoryModule,
    PriceListModule,
    PublicLinksModule,
    TaskStatusModule,
    EquipmentModule,
    QuotesModule,
    ReportsModule,
    OnboardingModule,

    // נטען אחרון: הוא מייבא את מודולי הדומיין שלמעלה, והעובדים
    // מתחילים לצרוך רק אחרי שכולם מוכנים.
    WorkerModule,
  ],
  // סדר ה-guards מהותי: throttle לפני auth (כדי שהצפה לא תבזבז
  // bcrypt), ו-auth לפני roles (כדי שתפקיד ייבדק רק על משתמש מזוהה).
  //
  // JwtAuthGuard גלובלי ולא per-controller: ככה נקודה שנשכחה מחזירה
  // 401 במקום להיות חשופה בשקט. נקודות פתוחות מסומנות ב-@Public().
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    // רץ אחרי ה-guards: אין טעם לתפוס מפתח אידמפוטנטיות לבקשה
    // שתידחה ממילא ב-401 או ב-403.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // רץ על כל בקשה: מזהה טננט מה-subdomain ופותח AsyncLocalStorage.
    // שים לב: הוא כבר *לא* מגדיר קונטקסט DB — זה נעשה per-transaction
    // ב-PrismaService.forTenant(). ראו docs/10-audit-findings.md#C1.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}

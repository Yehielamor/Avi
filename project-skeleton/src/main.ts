import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { json, urlencoded } from 'express';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppEnv } from './config/env.schema';

/**
 * ה-bootstrap הקודם היה ארבע שורות: create + listen. ללא ValidationPipe,
 * ללא helmet, ללא CORS, ללא תקרת body, וללא shutdown hooks — כך
 * ש-PrismaService.onModuleDestroy מעולם לא נורה ב-SIGTERM.
 * ראו docs/10-audit-findings.md#I2, #I31, #I32.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService<AppEnv, true>);
  const logger = new Logger('Bootstrap');
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const isProd = nodeEnv === 'production';

  app.useLogger(app.get(PinoLogger));

  // --- Proxy ---------------------------------------------------------------
  // Caddy הוא ה-hop היחיד לפנינו. בלי זה, req.ip הוא כתובת הקונטיינר
  // של Caddy, וכל rate limiting לפי IP מגביל את *כל* המשתמשים כאחד.
  app.set('trust proxy', 1);

  // --- Security headers ----------------------------------------------------
  app.use(
    helmet({
      // ה-API מגיש JSON בלבד; ה-UI יושב במקור נפרד.
      contentSecurityPolicy: isProd ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());

  // --- Body limits ---------------------------------------------------------
  // בלי זה, POST יחיד של 500MB מפוצץ את הזיכרון של הקונטיינר.
  // העלאות קבצים מוגבלות בנפרד ב-FileInterceptor של כל endpoint.
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // --- CORS ----------------------------------------------------------------
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });
  const baseDomain = config.get('BASE_DOMAIN', { infer: true });
  app.enableCors({
    origin: (origin, callback) => {
      // בקשות ללא Origin (curl, health probes, server-to-server) מותרות.
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      // תת-דומיינים של הטננטים — הם ה-UI הלגיטימי.
      try {
        const host = new URL(origin).hostname;
        if (host === baseDomain || host.endsWith(`.${baseDomain}`)) return callback(null, true);
      } catch {
        /* origin לא תקין — נופל ל-deny */
      }

      // `callback(null, false)` ולא `callback(new Error(...))`.
      //
      // זריקה כאן הופכת דחייה תקינה ל-500 — כלומר "תקלה בשרת" על
      // מקור שפשוט אינו ברשימה. זה גם מדליף את הרשימה בעקיפין,
      // וגם שולח דחיית CORS לניטור כאילו הייתה שגיאה.
      //
      // ההתנהגות הנכונה: לא לשלוח כותרת Access-Control-Allow-Origin.
      // הדפדפן חוסם, וזה בדיוק מה ש-CORS אמור לעשות.
      logger.warn(`Blocked cross-origin request from ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    // X-Tenant היא כותרת מותאמת, ולכן חייבת להופיע כאן במפורש —
    // אחרת ה-preflight נכשל והדפדפן חוסם את הבקשה עוד לפני שהיא
    // מגיעה לשרת. Idempotency-Key מאותה סיבה.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  // --- Validation ----------------------------------------------------------
  // whitelist + forbidNonWhitelisted הם מה שחוסם את
  // `POST /auth/register {"role":"OWNER"}` — שדה שאינו ב-DTO נדחה
  // ב-400 במקום להגיע ל-prisma.create. ראו docs/10-audit-findings.md#I2.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // בפרודקשן לא מחזירים את הערך שנכשל — הוא עלול להכיל סוד.
      disableErrorMessages: false,
      validationError: { target: false, value: !isProd },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(isProd));

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // --- Graceful shutdown ---------------------------------------------------
  // בלי זה onModuleDestroy לא נורה: חיבורי Prisma דולפים ובקשות
  // באוויר נהרגות בכל deploy.
  app.enableShutdownHooks();

  // --- OpenAPI -------------------------------------------------------------
  if (!isProd) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('CraftMind AI API')
        .setDescription('Multi-tenant work management platform')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json' });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
}

void bootstrap();

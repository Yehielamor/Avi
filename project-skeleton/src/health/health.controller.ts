import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * שתי נקודות נפרדות, בכוונה:
 *
 *   /health/live  — "התהליך חי". לא נוגע ב-DB. אם זה נכשל, הקונטיינר
 *                   צריך אתחול מחדש. זה מה ש-Docker HEALTHCHECK בודק.
 *
 *   /health/ready — "מוכן לקבל תעבורה". בודק DB. אם זה נכשל, לא
 *                   לאתחל — רק להוציא מה-load balancer.
 *
 * בגרסה הקודמת לא הייתה אף אחת מהן, ו-depends_on המתין רק לתחילת
 * קונטיינר. באתחול מחדש של המארח, האפליקציה עלתה לפני Postgres,
 * $connect זרק, Nest יצא, ו-restart:unless-stopped ייצר crash-loop.
 * ראו docs/10-audit-findings.md#I30.
 */
@ApiExcludeController()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('live')
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database', this.prisma, { timeout: 3000 }),
    ]);
  }
}

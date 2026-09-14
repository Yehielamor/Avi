import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { AppEnv } from '../config/env.schema';
import { QUEUE } from './queue.constants';

/**
 * תשתית התורים.
 *
 * Redis היה מוקם ב-docker-compose ולא בשימוש בכלל — שום דבר בקוד לא
 * התחבר אליו. כל עבודה ארוכה רצה בתוך בקשת HTTP: סנכרון Gmail עשה עד
 * עשר קריאות רשת סדרתיות, כל אחת ואחריה קריאת LLM, בתוך POST אחד.
 *
 * ראו docs/10-audit-findings.md#C10.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            // BullMQ דורש null במפורש: ברירת המחדל של ioredis מפסיקה
            // לנסות אחרי מכסה, ואז העובד מת בשקט אחרי נפילת Redis.
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: QUEUE.DOMAIN_EVENTS }, { name: QUEUE.INTAKE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}

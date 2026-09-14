import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import type { GoogleProvider } from './integrations.service';

const ALLOWED: readonly GoogleProvider[] = ['GMAIL', 'DRIVE'] as const;

/**
 * הגרסה הקודמת הצהירה `@Param('provider') provider: 'GMAIL' | 'DRIVE'`
 * וסמכה על הטיפוס. TypeScript לא קיים בזמן ריצה: כל מחרוזת בנתיב
 * זרמה ישר ל-`where.provider` של Prisma.
 */
@Injectable()
export class GoogleProviderParamPipe implements PipeTransform<string, GoogleProvider> {
  transform(value: string): GoogleProvider {
    const normalized = value?.toUpperCase();
    const match = ALLOWED.find((p) => p === normalized);
    if (!match) {
      throw new BadRequestException(`provider must be one of: ${ALLOWED.join(', ')}`);
    }
    return match;
  }
}

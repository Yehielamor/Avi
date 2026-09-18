import { Global, Module } from '@nestjs/common';

import { PublicLinkService } from './public-link.service';

/**
 * גלובלי: סטטוס משימה, קביעת מועד והצעת מחיר יוצרים ופותרים קישורים.
 * בלי זה כל אחד מהם היה מייבא את המודול, וזה השירות היחיד כאן.
 */
@Global()
@Module({
  providers: [PublicLinkService],
  exports: [PublicLinkService],
})
export class PublicLinksModule {}

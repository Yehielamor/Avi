import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { PublicQuoteController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [AuthModule],
  controllers: [QuotesController, PublicQuoteController],
  providers: [QuotesService],
})
export class QuotesModule {}

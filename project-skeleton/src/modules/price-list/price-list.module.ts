import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { PriceListController } from './price-list.controller';
import { PriceListService } from './price-list.service';

@Module({
  imports: [AuthModule],
  controllers: [PriceListController],
  providers: [PriceListService],
})
export class PriceListModule {}

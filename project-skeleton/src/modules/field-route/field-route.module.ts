import { Module } from '@nestjs/common';

import { FieldRouteController } from './field-route.controller';
import { FieldRouteService } from './field-route.service';

@Module({
  controllers: [FieldRouteController],
  providers: [FieldRouteService],
})
export class FieldRouteModule {}

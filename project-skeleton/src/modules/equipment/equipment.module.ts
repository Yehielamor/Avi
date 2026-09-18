import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { EquipmentController, PublicBookingController } from './equipment.controller';
import { EquipmentService } from './equipment.service';

@Module({
  imports: [AuthModule],
  controllers: [EquipmentController, PublicBookingController],
  providers: [EquipmentService],
})
export class EquipmentModule {}

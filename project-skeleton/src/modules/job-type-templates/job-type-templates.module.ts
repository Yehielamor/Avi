import { Module } from '@nestjs/common';
import { JobTypeTemplatesController } from './job-type-templates.controller';
import { JobTypeTemplatesService } from './job-type-templates.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [JobTypeTemplatesController],
  providers: [JobTypeTemplatesService],
  exports: [JobTypeTemplatesService],
})
export class JobTypeTemplatesModule {}

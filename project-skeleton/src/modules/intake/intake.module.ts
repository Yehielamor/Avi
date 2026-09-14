import { Module } from '@nestjs/common';

import { CustomersModule } from '../customers/customers.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TasksModule } from '../tasks/tasks.module';
import { EmailIntakeService } from './email-intake.service';
import { IntakeController } from './intake.controller';
import { IntakeExtractionService } from './intake-extraction.service';

// כיוון התלות: Intake → Integrations, ולא ההפך. קודם
// IntegrationsModule ייבא את IntakeModule כדי שה-controller שלו יוכל
// לתזמר מיילים; היפוך הכיוון הוא מה שמאפשר למודול התשתית לא לדעת
// דבר על משימות, לקוחות או LLM.
@Module({
  imports: [IntegrationsModule, TasksModule, CustomersModule],
  controllers: [IntakeController],
  providers: [IntakeExtractionService, EmailIntakeService],
  exports: [IntakeExtractionService, EmailIntakeService],
})
export class IntakeModule {}

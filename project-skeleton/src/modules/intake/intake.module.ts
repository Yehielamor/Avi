import { Module } from '@nestjs/common';

import { CustomersModule } from '../customers/customers.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TasksModule } from '../tasks/tasks.module';
import { EmailIntakeService } from './email-intake.service';
import { IntakeController } from './intake.controller';
import { IntakeExtractionService } from './intake-extraction.service';
import { InboundEmailService } from './inbound/inbound-email.service';
import { InboundEmailWebhookController, InboundMailboxController } from './inbound/inbound-email.controller';

// כיוון התלות: Intake → Integrations, ולא ההפך. קודם
// IntegrationsModule ייבא את IntakeModule כדי שה-controller שלו יוכל
// לתזמר מיילים; היפוך הכיוון הוא מה שמאפשר למודול התשתית לא לדעת
// דבר על משימות, לקוחות או LLM.
@Module({
  imports: [IntegrationsModule, TasksModule, CustomersModule],
  controllers: [IntakeController, InboundEmailWebhookController, InboundMailboxController],
  providers: [IntakeExtractionService, EmailIntakeService, InboundEmailService],
  exports: [IntakeExtractionService, EmailIntakeService],
})
export class IntakeModule {}

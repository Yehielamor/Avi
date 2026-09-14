import { Module } from '@nestjs/common';

import { CommsModule } from '../modules/comms/comms.module';
import { IntakeModule } from '../modules/intake/intake.module';
import { InventoryModule } from '../modules/inventory/inventory.module';
import { InvoicingModule } from '../modules/invoicing/invoicing.module';
import { SchedulingModule } from '../modules/scheduling/scheduling.module';
import { DomainEventsProcessor } from './domain-events.processor';
import { IntakeProcessor, IntakeScheduler } from './intake.processor';
import { OutboxPublisher } from './outbox.publisher';

/**
 * העובדים.
 *
 * מופרד מ-QueueModule בכוונה: QueueModule מספק את החיבור ל-Redis
 * ואת ה-queues (שגם ה-API צריך כדי לפרסם), בעוד שהמודול הזה מריץ
 * את הצרכנים. ההפרדה מאפשרת בעתיד לפרוס את העובדים כתהליך נפרד
 * מה-API — בלי לשנות אף שורה בקוד העסקי.
 */
@Module({
  imports: [SchedulingModule, InventoryModule, InvoicingModule, CommsModule, IntakeModule],
  providers: [OutboxPublisher, DomainEventsProcessor, IntakeScheduler, IntakeProcessor],
})
export class WorkerModule {}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { InvoicingService } from './invoicing.service';

// JwtAuthGuard רשום גלובלית (APP_GUARD), ולכן אין כאן @UseGuards —
// ראו docs/20-backend-conventions.md §3.
@Controller('invoices')
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  findAll(
    @Req() req: Request,
    @Query('customerId', new ParseUUIDPipe({ optional: true })) customerId?: string,
  ) {
    return this.invoicingService.findAll(req.tenantId!, customerId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get(':id')
  findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoicingService.findOne(req.tenantId!, id);
  }

  // פעולה יזומה של מנהל (מסמך הארכיטקטורה, סעיף 5.1 שורה 7).
  // מוגבלת ל-OWNER/MANAGER: טכנאי FIELD יכול היה קודם להפיק חשבוניות
  // בשם העסק, כי ה-UserRole נחתם ל-JWT ומעולם לא נאכף.
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('generate')
  generate(@Req() req: Request, @Body() body: GenerateInvoiceDto) {
    return this.invoicingService.generateInvoice(req.tenantId!, {
      customerId: body.customerId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });
  }
}

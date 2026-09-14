import {
  Controller,
  Post,
  Param,
  Req,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { SchedulingService } from './scheduling.service';

// endpoint ידני - שימושי כשה-auto-assign בסגירת האירוע נכשל
// (למשל: אף טכנאי לא היה זמין ברגע היצירה) ומנהל רוצה לנסות שוב,
// או לשייך מחדש ידנית אחרי ששינה זמינות טכנאי.
//
// ה-tenantId מגיע רק מ-req.tenantId (subdomain), לעולם לא מה-params.
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Post(':taskId/assign')
  async assign(@Req() req: Request, @Param('taskId', ParseUUIDPipe) taskId: string) {
    const result = await this.schedulingService.assignTask(req.tenantId!, taskId);
    if (!result.assigned) {
      throw new BadRequestException(result.reason ?? 'Could not assign task');
    }
    return result;
  }
}

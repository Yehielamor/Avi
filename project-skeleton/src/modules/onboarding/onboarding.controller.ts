import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { DocumentLearningService } from './document-learning.service';
import { OnboardingFinalizeService } from './onboarding-finalize.service';
import { OnboardingService } from './onboarding.service';
import {
  FinalizeDto,
  SendMessageDto,
  SESSION_SECRET_HEADER,
  UploadDocumentQueryDto,
} from './dto/onboarding.dto';
import { isAllowedMimetype, MAX_UPLOAD_BYTES, verifyUpload } from './upload-validation.util';

// ============================================================
// המודול היחיד שמסומן `@Public()` בשלמותו: onboarding קורה *לפני*
// שיש טננט או משתמש מאומת. ה-JwtAuthGuard הגלובלי היה חוסם אותו
// אחרת — וזו בדיוק הסיבה שהסימון מפורש ולא נשכח.
//
// מכיוון שאין כאן אימות, הגבלת הקצב היא ההגנה היחידה מול:
//   • יצירת סשנים המונית (כל אחד מהם סופג עד N קריאות LLM)
//   • /message שמניע עד 5 קריאות claude-sonnet-5 סדרתיות לבקשה,
//     על חשבון ה-Anthropic של המפעיל
//
// הבידוד בין סשנים הוא sessionSecret בלבד (מאומת בכל קריאה לשירות).
// ============================================================

@Public()
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly finalizeService: OnboardingFinalizeService,
    private readonly documentLearning: DocumentLearningService,
  ) {}

  /** יצירת סשן היא הכי זולה לתוקף והכי יקרה לנו — המכסה כאן הכי הדוקה. */
  @Throttle({
    short: { limit: 1, ttl: 60_000 },
    medium: { limit: 3, ttl: 15 * 60_000 },
    long: { limit: 10, ttl: 3_600_000 },
  })
  @Post('start')
  start() {
    return this.onboardingService.start();
  }

  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    medium: { limit: 40, ttl: 15 * 60_000 },
    long: { limit: 100, ttl: 3_600_000 },
  })
  @Post(':id/message')
  sendMessage(@Param('id', ParseUUIDPipe) id: string, @Body() body: SendMessageDto) {
    return this.onboardingService.sendMessage(id, body.sessionSecret, body.message);
  }

  /**
   * GET, ולכן אין גוף — הסוד מגיע בכותרת ולא ב-query string.
   */
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Get(':id/summary')
  getSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(SESSION_SECRET_HEADER) sessionSecret?: string,
  ) {
    return this.onboardingService.getSessionSummary(id, requireSecret(sessionSecret));
  }

  @Throttle({
    short: { limit: 3, ttl: 60_000 },
    medium: { limit: 20, ttl: 15 * 60_000 },
    long: { limit: 40, ttl: 3_600_000 },
  })
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      // בלי המגבלות האלה, multipart בלתי חסום נקרא כולו לזיכרון התהליך.
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 10 },
      // סינון מוקדם לפי ההצהרה של הלקוח. אימות האמת (magic bytes)
      // נעשה אחרי זה — mimetype הוא טענה, לא עובדה.
      fileFilter: (_req, file, cb) => {
        if (!isAllowedMimetype(file.mimetype)) {
          cb(new BadRequestException('Only PDF, plain text and CSV files are accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: UploadDocumentQueryDto,
    @Headers(SESSION_SECRET_HEADER) sessionSecret: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');

    // אימות הסשן לפני עיבוד הקובץ — פרסור PDF וקריאת LLM יקרים מדי
    // מכדי לבזבז אותם על בקשה לא מאומתת.
    await this.onboardingService.validateSession(id, requireSecret(sessionSecret));

    const kind = verifyUpload({ buffer: file.buffer, mimetype: file.mimetype, size: file.size });

    return this.documentLearning.processUploadedDocument(id, query.docType, {
      originalname: file.originalname,
      buffer: file.buffer,
      kind,
      sizeBytes: file.size,
    });
  }

  @Throttle({ short: { limit: 2, ttl: 60_000 }, medium: { limit: 5, ttl: 15 * 60_000 } })
  @Post(':id/finalize')
  finalize(@Param('id', ParseUUIDPipe) id: string, @Body() body: FinalizeDto) {
    return this.finalizeService.finalize(id, body.sessionSecret);
  }
}

function requireSecret(value: string | undefined): string {
  if (!value || value.length !== 64) {
    throw new BadRequestException(`Missing or malformed ${SESSION_SECRET_HEADER} header`);
  }
  return value;
}

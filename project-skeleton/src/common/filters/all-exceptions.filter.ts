import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * מסנן חריגות גלובלי.
 *
 * שתי מטרות:
 *   1. לא לדלוף פנימיות בפרודקשן. בגרסה הקודמת שגיאת Prisma גולמית
 *      הגיעה ללקוח, כולל שמות טבלאות ומבנה שאילתה.
 *   2. לתרגם שגיאות Postgres שמשמעותן אבטחתית — בפרט 42501, שהוא
 *      "הפרת RLS" או "קונטקסט טננט חסר". שתיהן באגים אצלנו, לא אצל
 *      הלקוח, והן חייבות להירשם כ-error ולא להיבלע.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, message, logLevel } = this.classify(exception);

    const detail = {
      method: req.method,
      url: req.url,
      status,
      tenantId: (req as Request & { tenantId?: string }).tenantId,
    };

    if (logLevel === 'error') {
      this.logger.error({ ...detail, err: exception }, message);
    } else {
      this.logger.warn(detail, message);
    }

    res.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }

  private classify(exception: unknown): {
    status: number;
    message: string;
    logLevel: 'warn' | 'error';
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        status: exception.getStatus(),
        message: Array.isArray(message) ? message.join('; ') : message,
        logLevel: exception.getStatus() >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: HttpStatus.CONFLICT, message: 'Resource already exists', logLevel: 'warn' };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, message: 'Resource not found', logLevel: 'warn' };
        case 'P2003':
          return { status: HttpStatus.BAD_REQUEST, message: 'Related resource does not exist', logLevel: 'warn' };
        default:
          break;
      }
    }

    // 42501 = insufficient_privilege. אצלנו זו תמיד הפרת RLS או
    // קונטקסט טננט חסר — כלומר באג שלנו שדורש התראה, לא 500 שקט.
    const raw = exception instanceof Error ? exception.message : String(exception);
    if (raw.includes('42501') || /row-level security|tenant context is not set/i.test(raw)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        logLevel: 'error',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.isProduction ? 'Internal server error' : raw,
      logLevel: 'error',
    };
  }
}

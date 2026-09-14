import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, Vertical } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { DocumentLearningService } from './document-learning.service';
import { OnboardingService } from './onboarding.service';
import type { JobTypeDraft, PriceCode, TeamMember } from './onboarding-schemas';
import { isReservedSubdomain, slugify } from './slugify.util';

const BCRYPT_ROUNDS = 12;

// ============================================================
// זו הפעולה **היחידה** בכל מודול ה-onboarding שכותבת ל-Tenant/User/
// JobTypeTemplate/PriceListItem בפועל, והיא נקראת רק דרך endpoint
// מפורש. זו ההפרדה בין "LLM מציע" ל"קוד דטרמיניסטי מבצע".
//
// שלושה שינויים מהותיים מול הגרסה הקודמת:
//
//   1. **אין `force`.** `{"force":true}` עקף את שער READY_TO_FINALIZE
//      ויצר Tenants ו-Users אמיתיים בכתובות אימייל שרירותיות —
//      אנונימית. השער הוא הבדיקה היחידה שהייתה שם, והפרמטר ביטל אותו.
//
//   2. **סיסמאות זמניות לא מוחזרות בתשובה.** הן נוצרות אקראית, אף
//      אחד לא רואה אותן, וכל המשתמשים מסומנים `mustChangePassword`.
//      הכניסה נעשית דרך זרימת הזמנה (ראו createInviteEvents).
//
//   3. **ה-hashing קורה לפני פתיחת הטרנזקציה.** bcrypt בעלות 12 הוא
//      ~300ms; 20 חברי צוות = 6 שניות, מעבר ל-timeout של הטרנזקציה,
//      והיצירה כולה התגלגלה אחורה אחרי שיחת LLM ארוכה.
// ============================================================

@Injectable()
export class OnboardingFinalizeService {
  private readonly logger = new Logger(OnboardingFinalizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly documentLearning: DocumentLearningService,
  ) {}

  async finalize(sessionId: string, sessionSecret: string) {
    const session = await this.onboardingService.validateSession(sessionId, sessionSecret);

    if (session.status === 'FINALIZED') {
      throw new ConflictException('This onboarding session was already finalized');
    }
    if (session.status !== 'READY_TO_FINALIZE') {
      throw new BadRequestException(
        'Onboarding chat has not signaled readiness yet - continue the conversation until the ' +
          'assistant confirms all required details were collected',
      );
    }

    const { companyInfo, teamMembers, priceCodes, jobTypes } = session.draft;

    if (!companyInfo) {
      throw new BadRequestException('Missing company info - the chat did not collect enough yet');
    }
    if (teamMembers.length === 0) {
      throw new BadRequestException('At least one team member (the business owner) is required');
    }
    // בעל העסק חייב להיות מוגדר: טננט בלי OWNER הוא טננט שאיש לא יכול לנהל.
    if (!teamMembers.some((m) => m.role === 'OWNER')) {
      throw new BadRequestException('Exactly one team member must be marked as OWNER');
    }
    const uniqueEmails = new Set(teamMembers.map((m) => m.email));
    if (uniqueEmails.size !== teamMembers.length) {
      throw new BadRequestException('Team member emails must be unique');
    }

    const subdomain = await this.generateUniqueSubdomain(companyInfo.legalName);
    const enabledModules = this.defaultModulesForVertical(companyInfo.vertical);

    // --- hashing לפני הטרנזקציה ------------------------------------------
    const preparedUsers = await Promise.all(
      teamMembers.map(async (member: TeamMember) => ({
        member,
        // סיסמה אקראית שאיש אינו יודע — כולל אנחנו. היא קיימת רק כדי
        // ש-passwordHash לא יהיה ריק; הכניסה נעשית דרך ההזמנה.
        passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), BCRYPT_ROUNDS),
      })),
    );

    // --- יצירת הטננט תחת RLS ---------------------------------------------
    // ה-id נוצר באפליקציה ולא ב-DB, כי המדיניות
    // `WITH CHECK (id = current_tenant_id())` צריכה להכיר אותו *לפני*
    // ה-INSERT. זהו המסלול המכוון — לא עוקפים RLS.
    const tenantId = randomUUID();

    await this.createTenantGraph(tenantId, subdomain, {
      companyInfo,
      enabledModules,
      preparedUsers,
      priceCodes,
      jobTypes,
    });

    const learningInsights = await this.documentLearning.computeSuggestedMarkup(sessionId);

    // הסשן נסגר **ופג**: הסוד לא נשאר תקף אחרי שהטננט כבר קיים.
    await this.prisma.untenanted.onboardingSession.updateMany({
      where: { id: sessionId, status: 'READY_TO_FINALIZE' },
      data: {
        status: 'FINALIZED',
        resultTenantId: tenantId,
        finalizedAt: new Date(),
        expiresAt: new Date(),
        version: { increment: 1 },
      },
    });

    this.logger.log({ tenantId, subdomain, users: preparedUsers.length }, 'Onboarding finalized');

    return {
      tenantId,
      subdomain,
      // אין `temporaryPassword` כאן, בכוונה. כל משתמש מקבל הזמנה למייל שלו.
      users: preparedUsers.map(({ member }) => ({
        email: member.email,
        name: member.name,
        role: member.role,
        invited: true,
      })),
      jobTypesCreated: jobTypes.length,
      priceCodesCreated: priceCodes.length,
      learningInsights,
    };
  }

  /**
   * יצירת כל הגרף של הטננט החדש בטרנזקציה אחת.
   *
   * TODO: ברגע ש-`TenantsService.createTenant()` יהיה ממומש (מודול
   * אחר בעבודה), הגוף הזה עובר לשם וכאן נשארת קריאה אחת. הוא לא
   * נקרא היום כי החתימה עדיין TODO.
   */
  private async createTenantGraph(
    tenantId: string,
    subdomain: string,
    input: {
      companyInfo: { legalName: string; vertical: Vertical };
      enabledModules: string[];
      preparedUsers: Array<{ member: TeamMember; passwordHash: string }>;
      priceCodes: PriceCode[];
      jobTypes: JobTypeDraft[];
    },
  ): Promise<void> {
    const { companyInfo, enabledModules, preparedUsers, priceCodes, jobTypes } = input;

    try {
      await this.prisma.forTenant(
        tenantId,
        async (tx) => {
          await tx.tenant.create({
            data: {
              id: tenantId,
              name: companyInfo.legalName,
              vertical: companyInfo.vertical,
              subdomain,
              config: {
                create: {
                  enabledModules,
                  theme: { primaryColor: '#2563eb', logoUrl: null },
                  schedulingWeights: enabledModules.includes('scheduling')
                    ? { skillWeight: 0.5, distanceWeight: 0.3, loadWeight: 0.2 }
                    : undefined,
                  emailTemplates: {
                    taskCreated: 'שלום {customerName}, קיבלנו את פנייתך ונחזור אליך בהקדם.',
                    taskClosed:
                      'שלום {customerName}, הטיפול בפנייתך הושלם. פירוט: {checklistSummary}',
                  },
                },
              },
            },
          });

          await tx.user.createMany({
            data: preparedUsers.map(({ member, passwordHash }) => ({
              tenantId,
              email: member.email,
              name: member.name,
              role: member.role,
              passwordHash,
              // אף אחד מהמשתמשים האלה לא בחר סיסמה. הדגל נאכף ב-JwtAuthGuard.
              mustChangePassword: true,
            })),
          });

          if (priceCodes.length > 0) {
            await tx.priceListItem.createMany({
              data: priceCodes.map((p: PriceCode) => ({
                tenantId,
                code: p.code,
                description: p.description,
                // כסף נכתב כ-Decimal, לא כ-float. ראו conventions#4.
                price: new Prisma.Decimal(p.defaultPrice.toFixed(2)),
              })),
              skipDuplicates: true,
            });
          }

          for (const jt of jobTypes) {
            await tx.jobTypeTemplate.create({
              data: {
                tenantId,
                name: jt.name,
                // מנורמל כאן, כמו בכל מסלול אחר — השוואה מול User.skills[]
                // נכשלה בשקט על רווח נגרר.
                requiredSkill: jt.requiredSkill?.trim().toLowerCase(),
                fields: jt.fields,
                defaultChecklist: jt.defaultChecklist,
              },
            });
          }

          // ההזמנות נכתבות ל-outbox באותה טרנזקציה. שליחת המייל עצמה
          // רצה בעובד — קריאת רשת בתוך טרנזקציה מחזיקה חיבור DB.
          await tx.outboxEvent.createMany({
            data: preparedUsers.map(({ member }) => ({
              tenantId,
              eventName: 'user.invited',
              payload: {
                email: member.email,
                name: member.name,
                role: member.role,
                subdomain,
                reason: 'onboarding_finalize',
              },
            })),
          });
        },
        // יצירת טננט כוללת עשרות INSERTs; ברירת המחדל של 10 שניות
        // מספיקה עכשיו שה-hashing מחוץ לטרנזקציה, אבל נשאיר מרווח.
        { timeoutMs: 20_000 },
      );
    } catch (err: unknown) {
      // המרוץ על תת-הדומיין נסגר כאן, באילוץ ה-DB — לא בבדיקה שקדמה לו.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'A tenant with this subdomain or a user with this email already exists',
        );
      }
      throw err;
    }
  }

  private defaultModulesForVertical(vertical: Vertical): string[] {
    // קמעונאות לא מפעילה Scheduling בכלל — אין "שיוך לטכנאי" כשאין צוות שטח.
    return vertical === Vertical.RETAIL
      ? ['intake', 'inventory', 'invoicing', 'comms']
      : ['intake', 'scheduling', 'inventory', 'invoicing', 'comms'];
  }

  /**
   * בדיקת ייחודיות תת-דומיין לפני שקיים טננט.
   *
   * חשוב: **אי אפשר** לעשות כאן `prisma.tenant.findUnique`. ל-`tenants`
   * יש policy `USING (id = current_tenant_id())`, ולכן שאילתה ללא
   * קונטקסט תחזיר תמיד אפס שורות — כלומר "התת-דומיין פנוי" לכל שם.
   * זה בדיוק סוג הכשל השקט שהקונבנציות מזהירות ממנו.
   *
   * `resolve_tenant_by_subdomain` היא ה-SECURITY DEFINER המצומצמת
   * שקיימת בדיוק לשאלה הזו. היא עדיין race מול יצירה מקבילה —
   * האילוץ `@unique` הוא הערובה, וכשל P2002 חוזר כ-409.
   */
  private async generateUniqueSubdomain(legalName: string): Promise<string> {
    const base = slugify(legalName);

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt}`;
      if (isReservedSubdomain(candidate)) continue;
      const taken = await this.prisma.resolveTenantBySubdomain(candidate);
      if (!taken) return candidate;
    }

    throw new ConflictException('Could not derive a free subdomain for this company name');
  }
}

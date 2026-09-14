import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../src/database/prisma.service';

/**
 * יצירת משתמש בטננט קיים.
 *
 * שימוש:
 *   npm run user:create -- --tenant ac-maintenance --email a@b.com \
 *                          --name "שם מלא" --role OWNER [--password ...] [--skills "מזגנים,חשמל"]
 *
 * הסקריפט רץ בתפקיד craftmind_app דרך forTenant, ולא ב-migrator כמו
 * ה-seed. זה מכוון: יצירת משתמש בטננט *קיים* היא בדיוק מה שהאפליקציה
 * עושה, ולכן היא צריכה לעבור באותו מסלול ולהיאכף ע"י אותו RLS.
 * (ה-seed שונה — הוא יוצר את הטננט עצמו, לפני שיש קונטקסט.)
 *
 * הסיסמה נוצרת אקראית אם לא סופקה, ומודפסת פעם אחת בלבד. היא לא
 * נשמרת בשום מקום — רק ה-hash.
 */

const BCRYPT_ROUNDS = 12;

function generatePassword(): string {
  // base64url: ללא תווים שמתבלבלים בהכתבה, ו-24 בתים נותנים מרווח
  // ביטחון גם אם המשתמש יעתיק חלקית.
  return randomBytes(18).toString('base64url');
}

function isUserRole(v: string): v is UserRole {
  return (Object.values(UserRole) as string[]).includes(v);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      password: { type: 'string' },
      skills: { type: 'string' },
      'must-change': { type: 'boolean', default: false },
    },
  });

  const { tenant: subdomain, email, name, role } = values;

  if (!subdomain || !email || !name || !role) {
    throw new Error(
      'Missing required argument.\n' +
        'Usage: npm run user:create -- --tenant <subdomain> --email <email> --name <name> --role <OWNER|MANAGER|FIELD>',
    );
  }

  if (!isUserRole(role)) {
    throw new Error(`Invalid role ${JSON.stringify(role)}. Expected one of: ${Object.values(UserRole).join(', ')}`);
  }

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const tenantId = await prisma.resolveTenantBySubdomain(subdomain);
    if (!tenantId) {
      throw new Error(`No active tenant with subdomain "${subdomain}".`);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const password = values.password ?? generatePassword();
    const generated = values.password === undefined;

    // ה-hash מחושב *לפני* פתיחת הטרנזקציה. bcrypt בעלות 12 לוקח ~300ms,
    // וזמן CPU בתוך טרנזקציה מחזיק חיבור DB ללא סיבה.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const skills = values.skills
      ? values.skills.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];

    const user = await prisma.forTenant(tenantId, (tx) =>
      tx.user.create({
        data: {
          tenantId,
          email: normalizedEmail,
          name: name.trim(),
          role,
          passwordHash,
          skills,
          mustChangePassword: values['must-change'] ?? false,
        },
        select: { id: true, email: true, name: true, role: true },
      }),
    );

    console.warn(
      [
        '',
        '✓ User created',
        '',
        `  tenant    ${subdomain}`,
        `  name      ${user.name}`,
        `  email     ${user.email}`,
        `  role      ${user.role}`,
        `  password  ${password}${generated ? '   (generated — shown once, not stored)' : ''}`,
        skills.length ? `  skills    ${skills.join(', ')}` : '',
        '',
      ]
        .filter((l) => l !== '')
        .join('\n') + '\n',
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error(`A user with that email already exists in tenant "${subdomain}".`);
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

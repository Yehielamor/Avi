import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ============================================================
// Seed ראשוני: טננט אחד לדוגמה - חברת אחזקת מזגנים (הלקוח האמיתי
// הראשון לפי ה-Roadmap, מסמך הארכיטקטורה סעיף 9).
//
// הרצה: npx prisma db seed  (אחרי migrate dev)
// ============================================================

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'ac-maintenance' },
    update: {},
    create: {
      name: 'חברת אחזקת מזגנים לדוגמה',
      vertical: 'MAINTENANCE',
      subdomain: 'ac-maintenance',
      config: {
        create: {
          enabledModules: ['intake', 'scheduling', 'inventory', 'invoicing', 'comms'],
          theme: { primaryColor: '#2563eb', logoUrl: null },
          schedulingWeights: { skillWeight: 0.5, distanceWeight: 0.3, loadWeight: 0.2 },
          emailTemplates: {
            taskClosed: 'שלום {customerName}, הטיפול בפנייתך הושלם. פירוט: {checklistSummary}',
            taskCreated: 'שלום {customerName}, קיבלנו את פנייתך ונחזור אליך בהקדם.',
          },
        },
      },
    },
  });

  const passwordHash = await bcrypt.hash('changeme123', 12);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'owner@ac-maintenance.example' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'owner@ac-maintenance.example',
      passwordHash,
      name: 'בעל העסק (דוגמה)',
      role: 'OWNER',
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'tech1@ac-maintenance.example' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'tech1@ac-maintenance.example',
      passwordHash,
      name: 'טכנאי לדוגמה',
      role: 'FIELD',
      skills: ['מזגנים', 'חשמל'],
      homeLat: 32.0853,
      homeLng: 34.7818,
    },
  });

  await prisma.jobTypeTemplate.upsert({
    where: { id: 'seed-ac-install-template' }, // מזהה קבוע לצורך idempotency ב-seed
    update: {},
    create: {
      id: 'seed-ac-install-template',
      tenantId: tenant.id,
      name: 'התקנת מזגן',
      requiredSkill: 'מזגנים',
      fields: [
        { key: 'address', label: 'כתובת התקנה', type: 'text', required: true },
        { key: 'ac_type', label: 'סוג מזגן', type: 'select', options: ['עילי', 'מיני מרכזי', 'מרכזי'], required: true },
        { key: 'floor', label: 'קומה', type: 'text', required: false },
      ],
      defaultPriority: 2,
      defaultChecklist: [
        { label: 'התקנת יחידה פנימית', priceCode: 'AC-INSTALL-INDOOR', sku: 'AC-INDOOR-UNIT', qty: 1 },
        { label: 'התקנת יחידה חיצונית', priceCode: 'AC-INSTALL-OUTDOOR', sku: 'AC-OUTDOOR-UNIT', qty: 1 },
        { label: 'בדיקת גז ותפקוד', priceCode: 'AC-GAS-CHECK' }, // אין sku - לא צורך חלק פיזי מהמלאי
      ],
    },
  });

  await prisma.priceListItem.createMany({
    data: [
      { tenantId: tenant.id, code: 'AC-INSTALL-INDOOR', description: 'התקנת יחידה פנימית', price: 350 },
      { tenantId: tenant.id, code: 'AC-INSTALL-OUTDOOR', description: 'התקנת יחידה חיצונית', price: 450 },
      { tenantId: tenant.id, code: 'AC-GAS-CHECK', description: 'בדיקת גז ותפקוד', price: 120 },
      { tenantId: tenant.id, code: 'AC-FILTER-REPLACE', description: 'החלפת פילטר', price: 80 },
    ],
    skipDuplicates: true,
  });

  // מלאי התחלתי - מקושר ל-sku-ים שהוגדרו ב-checklist למעלה. threshold
  // נמוך בכוונה (2) כדי שקל לבדוק את ה-low_stock alert עם כמות התקנות קטנה
  await prisma.inventoryItem.createMany({
    data: [
      { tenantId: tenant.id, sku: 'AC-INDOOR-UNIT', name: 'יחידה פנימית - מזגן עילי', quantity: 8, lowStockThreshold: 2, unitPrice: 1200 },
      { tenantId: tenant.id, sku: 'AC-OUTDOOR-UNIT', name: 'יחידה חיצונית - מזגן עילי', quantity: 8, lowStockThreshold: 2, unitPrice: 1400 },
      { tenantId: tenant.id, sku: 'AC-FILTER', name: 'פילטר החלפה סטנדרטי', quantity: 20, lowStockThreshold: 5, unitPrice: 45 },
    ],
    skipDuplicates: true,
  });

  console.log('Seed complete. Tenant subdomain:', tenant.subdomain);
  console.log('Login: owner@ac-maintenance.example / changeme123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

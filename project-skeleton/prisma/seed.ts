import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * נתוני דוגמה: חברת אחזקת מזגנים.
 *
 * ה-seed מתחבר בתפקיד craftmind_migrator, לא craftmind_app.
 *
 * הסיבה: תחת RLS כל שאילתה של ה-app חייבת קונטקסט טננט — וה-seed
 * יוצר את הטננט עצמו, כלומר רץ לפני שיש קונטקסט. ל-migrator יש
 * policy תחזוקה (מיגרציה 0003) בדיוק למקרה הזה.
 *
 * זה גם למה `db:seed` לא ירוץ בפרודקשן בטעות: הוא דורש
 * DIRECT_DATABASE_URL, שאינו מוגדר בקונטיינר האפליקציה.
 */
const migratorUrl = process.env.DIRECT_DATABASE_URL;
if (!migratorUrl) {
  throw new Error(
    'DIRECT_DATABASE_URL is required for seeding (the craftmind_migrator role). ' +
      'DATABASE_URL is the app role and cannot create a tenant — it has no tenant context yet.',
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: migratorUrl } } });

const SUBDOMAIN = 'ac-maintenance';
const DEMO_PASSWORD = 'DemoPassword2026';

/** ימים אחורה, כ-Date. תאריכים יחסיים כדי שהדמו לא יתיישן. */
const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

async function main(): Promise<void> {
  // ניקוי הרצה קודמת. הסדר חשוב — ילדים לפני הורים.
  const existing = await prisma.tenant.findUnique({ where: { subdomain: SUBDOMAIN } });
  if (existing) {
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { tenantId: existing.id } } });
    await prisma.stockMovement.deleteMany({ where: { tenantId: existing.id } });
    await prisma.task.deleteMany({ where: { tenantId: existing.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: existing.id } });
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  const tenantId = randomUUID();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'מיזוג אוויר כהן ובניו',
      vertical: 'MAINTENANCE',
      subdomain: SUBDOMAIN,
      config: {
        create: {
          enabledModules: ['intake', 'scheduling', 'inventory', 'invoicing', 'comms'],
          theme: { primaryColor: '#2563eb', logoUrl: null },
          schedulingWeights: { skillWeight: 0.5, distanceWeight: 0.3, loadWeight: 0.2 },
          emailTemplates: {
            taskCreated: 'שלום {customerName}, קיבלנו את פנייתך ונחזור אליך בהקדם.',
            taskClosed: 'שלום {customerName}, הטיפול בפנייתך הושלם. פירוט: {checklistSummary}',
          },
        },
      },
    },
  });

  // --- משתמשים ---
  const [, , tech1, tech2] = await Promise.all(
    [
      { name: 'יוסי כהן', email: 'owner@example.com', role: 'OWNER' as const, skills: [] },
      { name: 'רונית לוי', email: 'manager@example.com', role: 'MANAGER' as const, skills: [] },
      {
        name: 'אבי מזרחי',
        email: 'avi@example.com',
        role: 'FIELD' as const,
        skills: ['מזגנים', 'חשמל'],
        homeLat: 32.0853,
        homeLng: 34.7818,
      },
      {
        name: 'דני שמש',
        email: 'dani@example.com',
        role: 'FIELD' as const,
        skills: ['מזגנים'],
        homeLat: 32.0684,
        homeLng: 34.8248,
      },
    ].map((u) => prisma.user.create({ data: { ...u, tenantId, passwordHash } })),
  );

  // --- תבניות סוג עבודה ---
  const acService = await prisma.jobTypeTemplate.create({
    data: {
      tenantId,
      name: 'טיפול שנתי למזגן',
      requiredSkill: 'מזגנים',
      defaultPriority: 2,
      fields: [
        { key: 'unitCount', label: 'מספר יחידות', type: 'number', required: true },
        { key: 'floor', label: 'קומה', type: 'text', required: false },
      ],
      defaultChecklist: [
        { label: 'ניקוי מסננים', priceCode: 'AC-CLEAN', sku: 'FILTER-STD', qty: 1 },
        { label: 'בדיקת גז', priceCode: 'AC-GAS' },
        { label: 'ניקוי מאייד', priceCode: 'AC-COIL' },
      ],
    },
  });

  await prisma.jobTypeTemplate.create({
    data: {
      tenantId,
      name: 'התקנת מזגן חדש',
      requiredSkill: 'מזגנים',
      defaultPriority: 1,
      fields: [{ key: 'model', label: 'דגם', type: 'text', required: true }],
      defaultChecklist: [
        { label: 'התקנת יחידה פנימית', priceCode: 'AC-INSTALL-IN' },
        { label: 'התקנת יחידה חיצונית', priceCode: 'AC-INSTALL-OUT' },
        { label: 'חיבור צנרת', priceCode: 'AC-PIPE', sku: 'PIPE-3M', qty: 1 },
      ],
    },
  });

  // --- מחירון ---
  await prisma.priceListItem.createMany({
    data: [
      { tenantId, code: 'AC-CLEAN', description: 'ניקוי מסננים', price: new Prisma.Decimal('120.00') },
      { tenantId, code: 'AC-GAS', description: 'בדיקה ומילוי גז', price: new Prisma.Decimal('280.00') },
      { tenantId, code: 'AC-COIL', description: 'ניקוי מאייד', price: new Prisma.Decimal('190.00') },
      { tenantId, code: 'AC-INSTALL-IN', description: 'התקנת יחידה פנימית', price: new Prisma.Decimal('850.00') },
      { tenantId, code: 'AC-INSTALL-OUT', description: 'התקנת יחידה חיצונית', price: new Prisma.Decimal('950.00') },
      { tenantId, code: 'AC-PIPE', description: 'צנרת ובידוד', price: new Prisma.Decimal('340.50') },
    ],
  });

  // --- מלאי. חלק מתחת לסף בכוונה, כדי שמסך "מלאי בחוסר" לא יהיה ריק. ---
  await prisma.inventoryItem.createMany({
    data: [
      { tenantId, sku: 'FILTER-STD', name: 'מסנן סטנדרטי', quantity: 48, lowStockThreshold: 20, unitPrice: new Prisma.Decimal('35.00'), category: 'מסננים' },
      { tenantId, sku: 'FILTER-HEPA', name: 'מסנן HEPA', quantity: 4, lowStockThreshold: 10, unitPrice: new Prisma.Decimal('120.00'), category: 'מסננים' },
      { tenantId, sku: 'GAS-R32-1KG', name: 'גז R32 - ק"ג', quantity: 12, lowStockThreshold: 5, unitPrice: new Prisma.Decimal('95.00'), category: 'גזים' },
      { tenantId, sku: 'PIPE-3M', name: 'צנרת נחושת 3 מטר', quantity: 2, lowStockThreshold: 6, unitPrice: new Prisma.Decimal('210.00'), category: 'צנרת' },
      { tenantId, sku: 'BRACKET-STD', name: 'מתקן תלייה', quantity: 31, lowStockThreshold: 8, unitPrice: new Prisma.Decimal('65.00'), category: 'אביזרים' },
      { tenantId, sku: 'REMOTE-UNI', name: 'שלט אוניברסלי', quantity: 0, lowStockThreshold: 4, unitPrice: new Prisma.Decimal('55.00'), category: 'אביזרים' },
    ],
  });

  // --- לקוחות ---
  const customers = await Promise.all(
    [
      { name: 'משרדי אלפא בע"מ', email: 'office@alpha.co.il', phone: '03-5551234', address: 'רוטשילד 12, תל אביב', lat: 32.0631, lng: 34.7714 },
      { name: 'מסעדת הגליל', email: 'info@galil-rest.co.il', phone: '04-8887766', address: 'הרצל 45, חיפה', lat: 32.815, lng: 34.9892 },
      { name: 'דנה ברקוביץ', email: 'dana.b@gmail.com', phone: '052-4445566', address: 'ביאליק 8, רמת גן', lat: 32.0823, lng: 34.8114 },
      { name: 'קליניקת שיניים סמייל', email: 'contact@smile-dental.co.il', phone: '09-7778899', address: 'ויצמן 30, כפר סבא', lat: 32.1743, lng: 34.9077 },
    ].map((c) => prisma.customer.create({ data: { ...c, tenantId } })),
  );

  const [alpha, galil, dana, smile] = customers;

  // --- משימות בכל מצב, כדי שהסינון במסך יהיה משמעותי ---
  const tasks = [
    { customerId: alpha!.id, title: 'טיפול שנתי - 6 יחידות במשרד', status: 'NEW' as const, priority: 2, source: 'EMAIL' as const, createdAt: daysAgo(0), assignedToUserId: null, sourceEmailId: 'seed-msg-001' },
    { customerId: galil!.id, title: 'מזגן במטבח לא מקרר - דחוף', status: 'ASSIGNED' as const, priority: 1, source: 'EMAIL' as const, createdAt: daysAgo(1), assignedToUserId: tech1!.id, sourceEmailId: 'seed-msg-002' },
    { customerId: dana!.id, title: 'התקנת מזגן בסלון', status: 'IN_PROGRESS' as const, priority: 2, source: 'MANUAL' as const, createdAt: daysAgo(2), assignedToUserId: tech2!.id },
    { customerId: smile!.id, title: 'טיפול שנתי - 3 חדרי טיפולים', status: 'CLOSED' as const, priority: 2, source: 'MANUAL' as const, createdAt: daysAgo(12), closedAt: daysAgo(10), assignedToUserId: tech1!.id },
    { customerId: alpha!.id, title: 'החלפת מסננים בקומה 3', status: 'CLOSED' as const, priority: 3, source: 'EMAIL' as const, createdAt: daysAgo(20), closedAt: daysAgo(18), assignedToUserId: tech2!.id, sourceEmailId: 'seed-msg-003' },
    { customerId: galil!.id, title: 'רעש חריג מהיחידה החיצונית', status: 'CANCELLED' as const, priority: 2, source: 'MANUAL' as const, createdAt: daysAgo(30) },
  ];

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        ...t,
        tenantId,
        jobTypeTemplateId: acService.id,
        description:
          t.source === 'EMAIL'
            ? 'שלום,\nנשמח לתאם טיפול בהקדם האפשרי.\nתודה.'
            : null,
        checklist:
          t.status === 'CLOSED'
            ? [
                { label: 'ניקוי מסננים', done: true, priceCode: 'AC-CLEAN', sku: 'FILTER-STD', qty: 1 },
                { label: 'בדיקת גז', done: true, priceCode: 'AC-GAS' },
                { label: 'ניקוי מאייד', done: false, priceCode: 'AC-COIL' },
              ]
            : [
                { label: 'ניקוי מסננים', done: false, priceCode: 'AC-CLEAN', sku: 'FILTER-STD', qty: 1 },
                { label: 'בדיקת גז', done: false, priceCode: 'AC-GAS' },
                { label: 'ניקוי מאייד', done: false, priceCode: 'AC-COIL' },
              ],
      },
    });
  }

  // --- חשבונית לדוגמה. הסכום מחושב ב-Decimal, לא ב-float. ---
  const lines = [
    { priceCode: 'AC-CLEAN', description: 'ניקוי מסננים', amount: new Prisma.Decimal('120.00') },
    { priceCode: 'AC-GAS', description: 'בדיקה ומילוי גז', amount: new Prisma.Decimal('280.00') },
    { priceCode: 'AC-PIPE', description: 'צנרת ובידוד', amount: new Prisma.Decimal('340.50') },
  ];
  const total = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));

  await prisma.invoice.create({
    data: {
      tenantId,
      customerId: smile!.id,
      invoiceNumber: 1,
      periodStart: daysAgo(40),
      periodEnd: daysAgo(10),
      totalAmount: total,
      status: 'FINALIZED',
      finalizedAt: daysAgo(9),
      lineItems: { create: lines },
    },
  });

  console.warn(`
✓ Seed complete

  Tenant     ${SUBDOMAIN}  (${tenantId})
  Users      owner@example.com / manager@example.com / avi@example.com / dani@example.com
  Password   ${DEMO_PASSWORD}
  Data       ${customers.length} customers · ${tasks.length} tasks · 6 SKUs · 1 invoice

  Tenant resolution needs a subdomain. Add to /etc/hosts:
    127.0.0.1 ${SUBDOMAIN}.craftmind-ai.localhost
  and set BASE_DOMAIN=craftmind-ai.localhost
`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

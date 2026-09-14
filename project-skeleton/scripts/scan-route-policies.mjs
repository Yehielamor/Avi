// =============================================================================
// סורק: האם לכל נתיב יש מדיניות גישה מפורשת?
// =============================================================================
// ה-RolesGuard נכשל סגור — נתיב ללא @Roles/@AnyRole/@Public מוחזר ב-403
// עם הודעה מזהה. הסקריפט הזה מנצל את זה כדי למצוא נתיבים שנשכחו.
//
// למה סקריפט ולא grep: grep על דקורטורים נותן תשובות שגויות. הוא
// מפספס דקורטור ברמת מחלקה, נופל על סדר שורות, ואינו יודע אילו
// נתיבים באמת נרשמו. הבדיקה כאן היא מול השרת הרץ.
//
// הערה: הבקשות נושאות X-Tenant ולא Host — Node חוסם קביעת Host
// כ-forbidden header, וכל בקשה הייתה נופלת לפני ה-guard ונותנת
// "הכל תקין" כוזב.
//
// שימוש:
//   LOG_LEVEL=info node dist/main    # נדרש כדי ששורות Mapped יירשמו
//   node scripts/scan-route-policies.mjs <password> [logfile]
// =============================================================================
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3100/v1';
// Node חוסם קביעת Host כ-forbidden header, ולכן כל בקשה יצאה ללא
// טננט ונפלה עוד לפני ה-RolesGuard — מה שנתן "הכל מסומן" כוזב.
// X-Tenant הוא בדיוק המסלול שנבנה למקרה הזה.
const TENANT = 'ac-maintenance';
const UUID = '00000000-0000-0000-0000-000000000000';

const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'yehiel@craftmind-ai.com', password: process.argv[2] }),
  });
  return (await r.json()).accessToken;
};

const log = fs.readFileSync('/tmp/srv.log', 'utf8');
const routes = [...new Set(
  [...log.matchAll(/Mapped \{([^,]+), (GET|POST|PATCH|PUT|DELETE)\}/g)].map((m) => `${m[2]} ${m[1]}`),
)].filter((r) => !r.includes('/health/'));

const token = await login();
const unmarked = [];

for (const route of routes) {
  const [method, path] = route.split(' ');
  const url = BASE + path.replace(/:[a-zA-Z]+/g, UUID);
  const res = await fetch(url, {
    method,
    headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : '{}',
  });
  const body = await res.text();
  if (body.includes('no access policy')) unmarked.push(route);
}

console.log(`נסרקו ${routes.length} נתיבים`);
if (unmarked.length === 0) console.log('✓ לכל הנתיבים יש מדיניות גישה מפורשת');
else { console.log('❌ ללא מדיניות:'); unmarked.forEach((r) => console.log('   ' + r)); }

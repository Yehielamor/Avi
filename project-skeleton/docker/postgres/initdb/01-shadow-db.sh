#!/bin/bash
# בסיס נתונים צל ל-`prisma migrate dev`. Prisma צריך DB זמני כדי לגלות
# drift ולייצר מיגרציות. ללא DB כזה מראש, craftmind_migrator היה זקוק
# להרשאת CREATEDB — הרחבה מיותרת לתפקיד שכל תפקידו להריץ DDL על סכימה אחת.
# לא בשימוש בפרודקשן (`migrate deploy` לא נוגע בו).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE DATABASE craftmind_shadow OWNER craftmind_migrator;
SQL
echo "[initdb] craftmind_shadow created (dev only)"

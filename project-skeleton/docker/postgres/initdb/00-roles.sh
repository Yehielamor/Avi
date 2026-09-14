#!/bin/bash
# =============================================================================
# בוטסטראפ תפקידי DB — רץ פעם אחת, באתחול הראשון של ה-volume, כ-superuser.
#
# למה שני תפקידים ולא אחד:
#
#   PostgreSQL פוטר את *בעל הטבלה* מ-policies של RLS. בגרסה הקודמת
#   האפליקציה התחברה באותו תפקיד שיצר את הטבלאות, ולכן כל קובץ ה-RLS
#   היה no-op מוחלט. ראו docs/10-audit-findings.md#I3.
#
#   craftmind_migrator — הבעלים. מריץ מיגרציות בלבד. לא מקבל בקשות HTTP.
#   craftmind_app      — זהות זמן-הריצה. *לא* בעלים, ולכן ה-RLS חל עליו.
#                        בנוסף מוגדר FORCE ROW LEVEL SECURITY כחגורה שנייה.
#
# שני התפקידים NOSUPERUSER ו-NOBYPASSRLS במפורש. אין תפקיד באפליקציה
# שיכול לעקוף בידוד טננטים — כולל בטעות.
# =============================================================================
set -euo pipefail

: "${CRAFTMIND_MIGRATOR_PASSWORD:?CRAFTMIND_MIGRATOR_PASSWORD is required}"
: "${CRAFTMIND_APP_PASSWORD:?CRAFTMIND_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v migrator_password="'${CRAFTMIND_MIGRATOR_PASSWORD}'" \
     -v app_password="'${CRAFTMIND_APP_PASSWORD}'" <<'SQL'

-- ---------------------------------------------------------------------------
-- תפקידים
-- ---------------------------------------------------------------------------
CREATE ROLE craftmind_migrator
  LOGIN PASSWORD :migrator_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE ROLE craftmind_app
  LOGIN PASSWORD :app_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- ---------------------------------------------------------------------------
-- בעלות על הסכימה: ה-migrator בונה, ה-app רק משתמש.
-- ---------------------------------------------------------------------------
ALTER SCHEMA public OWNER TO craftmind_migrator;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT  USAGE ON SCHEMA public TO craftmind_app;

-- ---------------------------------------------------------------------------
-- הרשאות על אובייקטים ש-migrator ייצור *בעתיד*. בלי זה, כל טבלה
-- חדשה ממיגרציה עתידית תהיה בלתי נגישה ל-app עד ל-GRANT ידני —
-- וזה בדיוק סוג הצעד הידני שנשכח.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE craftmind_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO craftmind_app;

ALTER DEFAULT PRIVILEGES FOR ROLE craftmind_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO craftmind_app;

ALTER DEFAULT PRIVILEGES FOR ROLE craftmind_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO craftmind_app;

-- ---------------------------------------------------------------------------
-- הקשחה: אף אחד לא יוצר טבלאות ב-public חוץ מה-migrator.
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM craftmind_app;
GRANT  CREATE ON SCHEMA public TO   craftmind_migrator;

SQL

echo "[initdb] craftmind_migrator + craftmind_app created; public schema owned by migrator"

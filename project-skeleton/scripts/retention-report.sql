-- דו"ח שימור: האם בעלי עסקים חוזרים?
--
-- רץ כ-craftmind_migrator (עוקף RLS דרך migrator_maintenance), לא כתפקיד האפליקציה:
--   psql "$DIRECT_DATABASE_URL" -f scripts/retention-report.sql
--
-- "יום פעיל" = יום שבו משתמש OWNER/MANAGER פתח את תדריך הבוקר (activity_days).
-- יום 0 = יום ההרשמה של הטננט, לפי שעון ישראל.
WITH t AS (
  SELECT id, name, ("createdAt" AT TIME ZONE 'Asia/Jerusalem')::date AS signup
  FROM tenants
),
d AS (
  SELECT a."tenantId", a.day - t.signup AS n
  FROM activity_days a JOIN t ON t.id = a."tenantId"
)
SELECT
  t.name,
  t.signup,
  current_date - t.signup                                                     AS age_days,
  count(DISTINCT d.n) FILTER (WHERE d.n BETWEEN 0 AND 6)                      AS active_days_week1,
  count(DISTINCT d.n) FILTER (WHERE d.n BETWEEN 7 AND 13)                     AS active_days_week2,
  bool_or(d.n BETWEEN 7 AND 9)                                                AS back_day8,
  bool_or(d.n BETWEEN 28 AND 34)                                              AS back_day30,
  max(t.signup + d.n)                                                         AS last_active
FROM t LEFT JOIN d ON d."tenantId" = t.id
GROUP BY t.id, t.name, t.signup
ORDER BY t.signup DESC;

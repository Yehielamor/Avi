#!/bin/bash
# גיבוי לילי של ה-DB. פורמט custom (pg_dump -Fc) — דחוס, וניתן לשחזר ממנו
# טבלה בודדת. שומר 14 יום אחורה. נכשל בקול: cron שולח מייל רק על פלט,
# ולכן כל שגיאה נכתבת ל-stderr ולקובץ הלוג.
set -euo pipefail
cd /opt/craftmind
PW=$(grep ^POSTGRES_SUPER_PASSWORD= .env | cut -d= -f2-)
OUT=backups/craftmind-$(date +%Y%m%d-%H%M%S).dump
docker exec -e PGPASSWORD="$PW" craftmind-postgres-1 pg_dump -U postgres -d craftmind -Fc > "$OUT.tmp"
# קובץ ריק או חתוך לא ייחשב גיבוי: pg_restore --list חייב להצליח עליו.
docker exec -i craftmind-postgres-1 pg_restore --list < "$OUT.tmp" > /dev/null
mv "$OUT.tmp" "$OUT"; chmod 600 "$OUT"
find backups -name "craftmind-*.dump" -mtime +14 -delete
echo "$(date -Is) ok $OUT $(stat -c %s "$OUT") bytes" >> backups/backup.log

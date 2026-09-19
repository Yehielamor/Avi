#!/usr/bin/env bash
# כל שערי האיכות האוטומטיים, בפקודה אחת, בסדר מהזול ליקר.
# נעצר בכישלון הראשון. דורש Postgres מקומי (5433) ו-.env — כמו בפיתוח.
#
#   scripts/qa.sh            הכל
#   scripts/qa.sh --fast     בלי בדיקות integration (שניות במקום דקות)
#   scripts/qa.sh --verbose  כל הפלט, כמו קודם
#
# הפלט של כל שלב נשמר בקובץ ומוצג רק אם השלב נכשל. הבדיקות מדמות תקלות
# בכוונה (SMTP נופל, DB נעלם) ו-Nest מדפיס אותן כ-ERROR — בפלט מלא זה נראה
# כמו כישלון גם כשהכל עובר.
set -uo pipefail
cd "$(dirname "$0")/.."

FAST=0; VERBOSE=0
for a in "$@"; do
  case "$a" in
    --fast) FAST=1 ;;
    --verbose) VERBOSE=1 ;;
  esac
done

LOGDIR=$(mktemp -d "${TMPDIR:-/tmp}/craftmind-qa.XXXXXX")
START=$(date +%s)

# שם שלב, ואז הפקודה. מדפיס שורה אחת: ✔ + סיכום, או ✘ + סוף הלוג.
step() {
  local name="$1"; shift
  local log="$LOGDIR/$(echo "$name" | tr -c 'A-Za-z0-9' '_').log"
  local t0=$(date +%s)
  printf '  %-34s' "$name"
  if [[ $VERBOSE == 1 ]]; then echo; "$@" 2>&1 | tee "$log"; local rc=${PIPESTATUS[0]}
  else "$@" >"$log" 2>&1; local rc=$?; fi
  local dt=$(( $(date +%s) - t0 ))
  # סיכום מספרי מתוך הלוג, אם יש (jest / vitest).
  local summary
  summary=$(grep -hE '^Tests:|^ +Tests +[0-9]' "$log" | tail -1 | sed -E 's/^ *Tests:? *//; s/ +/ /g')
  if [[ $rc == 0 ]]; then
    printf '\033[32m✔\033[0m %3ss  %s\n' "$dt" "$summary"
  else
    printf '\033[31m✘\033[0m %3ss\n\n' "$dt"
    tail -60 "$log"
    printf '\n\033[31m✘ נכשל: %s\033[0m  (לוג מלא: %s)\n' "$name" "$log"
    exit 1
  fi
}

echo "CraftMind — שערי איכות"
step "Backend: typecheck"      npx tsc --noEmit -p tsconfig.json
step "Backend: lint"           npm run -s lint
step "Backend: unit"           npx jest --config test/jest-unit.config.ts --silent
if [[ $FAST == 0 ]]; then
  step "Backend: integration"  npx jest --config test/jest-integration.config.ts --runInBand --silent
fi
step "Web: typecheck"          bash -c 'cd frontend-web && npx tsc -b'
step "Web: lint"               bash -c 'cd frontend-web && npm run -s lint'
step "Web: tests"              bash -c 'cd frontend-web && npx vitest run'
step "Web: build"              bash -c 'cd frontend-web && npx vite build --mode selfhost'
step "PWA: typecheck"          bash -c 'cd frontend-pwa && npx tsc -b'
step "PWA: lint"               bash -c 'cd frontend-pwa && npm run -s lint'
step "PWA: tests"              bash -c 'cd frontend-pwa && npx vitest run'
step "PWA: build"              bash -c 'cd frontend-pwa && npx vite build --mode selfhost'
step "Email worker: typecheck" bash -c 'cd deploy/email-worker && { [ -d node_modules ] || npm ci --silent; } && npx tsc -p tsconfig.json'

printf '\n\033[1;32m✔ כל השערים עברו\033[0m (%ss)\n' "$(( $(date +%s) - START ))"
rm -rf "$LOGDIR"

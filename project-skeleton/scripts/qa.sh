#!/usr/bin/env bash
# כל שערי האיכות האוטומטיים, בפקודה אחת, בסדר מהזול ליקר.
# נעצר בכישלון הראשון. דורש Postgres מקומי (5433) ו-.env — כמו בפיתוח.
#
#   scripts/qa.sh          הכל
#   scripts/qa.sh --fast   בלי בדיקות integration (שניות במקום דקות)
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

step "Backend: typecheck";            npx tsc --noEmit -p tsconfig.json
step "Backend: lint";                 npm run -s lint
step "Backend: unit";                 npx jest --config test/jest-unit.config.ts --silent
if [[ "${1:-}" != "--fast" ]]; then
  step "Backend: integration (Postgres אמיתי, RLS)"
  npx jest --config test/jest-integration.config.ts --runInBand --silent
fi
step "Web: typecheck";                (cd frontend-web && npx tsc -b)
step "Web: tests";                    (cd frontend-web && npx vitest run)
step "Web: build";                    (cd frontend-web && npx vite build --mode selfhost >/dev/null)
step "PWA: typecheck + build";        (cd frontend-pwa && npx tsc -b && npx vite build --mode selfhost >/dev/null)

printf '\n\033[1;32m✔ כל השערים עברו\033[0m\n'

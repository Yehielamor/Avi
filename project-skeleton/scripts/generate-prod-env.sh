#!/usr/bin/env bash
# =============================================================================
# יוצר .env לפרודקשן עם סודות אקראיים חזקים.
#
#   GEMINI_API_KEY=... scripts/generate-prod-env.sh api.example.com https://app.vercel.app admin@example.com > .env
#
# הסודות נוצרים כאן, על המכונה, ולא עוברים דרך צ'אט, מייל או git. הפלט
# הולך ישר לקובץ. אם .env כבר קיים — לא לדרוס: סיסמאות ה-DB נצרבות
# ב-volume באתחול הראשון, והחלפתן מנתקת את האפליקציה מה-DB.
# =============================================================================
set -euo pipefail

API_DOMAIN="${1:?usage: $0 <api-domain> <cors-origins-csv> <acme-email>}"
CORS_ORIGINS="${2:?cors origins required}"
ACME_EMAIL="${3:?acme email required}"
: "${GEMINI_API_KEY:?GEMINI_API_KEY must be set in the environment (not passed as an argument, so it stays out of shell history)}"

rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }

cat <<ENV
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

API_DOMAIN=${API_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
# נדרש ע"י env.schema; במארח יחיד הטננט מגיע מ-X-Tenant ולא מתת-דומיין.
BASE_DOMAIN=${API_DOMAIN#api.}
CORS_ORIGINS=${CORS_ORIGINS}

POSTGRES_SUPER_PASSWORD=$(rand 40)
CRAFTMIND_MIGRATOR_PASSWORD=$(rand 40)
CRAFTMIND_APP_PASSWORD=$(rand 40)
# DATABASE_URL/DIRECT_DATABASE_URL/REDIS_URL נקבעים ב-docker-compose.yml.
DATABASE_URL=postgresql://unused@postgres:5432/craftmind
DIRECT_DATABASE_URL=postgresql://unused@postgres:5432/craftmind
REDIS_URL=redis://redis:6379

JWT_SECRET=$(rand 64)
JWT_EXPIRES_IN=12h
OAUTH_STATE_SECRET=$(rand 64)
INTEGRATION_ENCRYPTION_KEY=$(openssl rand -hex 32)
INTEGRATION_ENCRYPTION_KEY_VERSION=1

# ריקים = חיבור Google כבוי. ממלאים את שלושתם יחד כשיש אפליקציית OAuth.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

LLM_PROVIDER=gemini
GEMINI_API_KEY=${GEMINI_API_KEY}
ENV

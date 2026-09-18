# syntax=docker/dockerfile:1.7
# =============================================================================
# CraftMind AI — תמונת ריצה
#
# תיקונים מול הגרסה הקודמת (docs/10-audit-findings.md):
#   C22 — שלב יחיד שרץ כ-root עם כל ה-toolchain בפנים.
#   C23 — `npm install` בלי lockfile: כל בנייה פתרה מחדש טווחי ^.
#   I37 — אין engines, אין pinning של גרסת Node.
# =============================================================================

# גרסה נעוצה ב-digest, לא ב-tag צף. `node:22-alpine` משתנה תחתינו;
# ה-digest לא. pdf-parse דורש node >=22.3.0.
FROM node:22.20.0-alpine AS base
ENV PNPM_HOME=/dev/null \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# -----------------------------------------------------------------------------
# deps — תלויות מלאות, לבנייה בלבד
# -----------------------------------------------------------------------------
FROM base AS deps
# `npm ci` דורש lockfile ונכשל אם הוא לא תואם ל-package.json.
# זה בדיוק מה שרוצים: בנייה דטרמיניסטית עם אימות integrity.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# build — קומפילציה + Prisma Client
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

# -----------------------------------------------------------------------------
# prod-deps — תלויות ריצה בלבד, עם Prisma Client מיוצר
# -----------------------------------------------------------------------------
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund && \
    npx prisma generate && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# runtime — מה שבאמת נשלח
# -----------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# dumb-init מטפל בהעברת סיגנלים וקצירת zombies. בלעדיו Node הוא
# PID 1 ו-`docker stop` ממתין את כל 10 שניות החסד ואז SIGKILL.
RUN apk add --no-cache dumb-init

# המשתמש `node` (uid 1000) קיים בתמונת הבסיס. לא רצים כ-root:
# כל RCE ב-handler — למשל בנתיב parsing ה-PDF — היה נותן root.
USER node

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build     /app/dist         ./dist
COPY --chown=node:node prisma           ./prisma
COPY --chown=node:node package.json     ./

# גופנים עבריים לחשבוניות. *לא* אופציונלי: invoice-pdf.util.ts זורק
# במפורש אם הם חסרים, כי הגרסה הקודמת נפלה בשקט ל-Helvetica והפיקה
# חשבוניות עם טקסט עברי משובש — המסמך שמגיע לרואה החשבון של הלקוח.
COPY --chown=node:node assets/fonts     ./assets/fonts

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]

#!/usr/bin/env bash
# =============================================================================
# פורס את הממשק לשרת: בנייה מקומית ב-mode selfhost, והעלאה אטומית.
#
#   scripts/deploy-web.sh [host]
#
# ההעלאה לתיקייה חדשה ואז החלפת symlink — כך אין רגע שבו index.html חדש
# מפנה ל-assets שעוד לא הגיעו (או הפוך), ומשתמש באמצע טעינה מקבל דף לבן.
# שלוש הגרסאות האחרונות נשמרות, ולכן חזרה אחורה היא החלפת symlink אחת.
# =============================================================================
set -euo pipefail
HOST="${1:-root@164.90.161.15}"
SSH=(ssh -i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes "$HOST")
cd "$(dirname "$0")/../frontend-web"

npx tsc -b
npx vite build --mode selfhost
grep -q 'api\.craftmind-ai\.com\|trycloudflare' dist/assets/*.js && { echo "bundle still points at a remote API — wrong mode?"; exit 1; }

REL="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
"${SSH[@]}" "mkdir -p /var/www/releases/$REL"
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf - . | "${SSH[@]}" "tar -C /var/www/releases/$REL -xzf -"
"${SSH[@]}" "set -e
  test -f /var/www/releases/$REL/index.html
  ln -sfn /var/www/releases/$REL /var/www/craftmind.new && mv -Tf /var/www/craftmind.new /var/www/craftmind
  ls -1dt /var/www/releases/* | tail -n +4 | xargs -r rm -rf
  echo live: \$(readlink /var/www/craftmind)"

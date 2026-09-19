#!/usr/bin/env bash
# =============================================================================
# פורס את אפליקציית הטכנאי (PWA) ל-craftmind-ai.com/field/.
#
#   scripts/deploy-field.sh [host]
#
# אותו דפוס כמו deploy-web.sh: תיקיית גרסה חדשה, ואז החלפת symlink אטומית.
# שלוש הגרסאות האחרונות נשמרות. חזרה אחורה:
#   ssh root@164.90.161.15 'ls -1dt /var/www/field-releases/*'
#   ssh root@164.90.161.15 'ln -sfn /var/www/field-releases/<REL> /var/www/craftmind-field'
# =============================================================================
set -euo pipefail
HOST="${1:-root@164.90.161.15}"
SSH=(ssh -i "$HOME/.ssh/id_ed25519" -o IdentitiesOnly=yes "$HOST")
cd "$(dirname "$0")/../frontend-pwa"

npx tsc -b
npx vite build --mode selfhost
grep -q '"/field/sw.js"' dist/assets/*.js || { echo "bundle is not built for /field/ — wrong mode?"; exit 1; }

REL="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
"${SSH[@]}" "mkdir -p /var/www/field-releases/$REL"
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf - . | "${SSH[@]}" "tar -C /var/www/field-releases/$REL -xzf -"
"${SSH[@]}" "set -e
  test -f /var/www/field-releases/$REL/index.html
  ln -sfn /var/www/field-releases/$REL /var/www/craftmind-field.new && mv -Tf /var/www/craftmind-field.new /var/www/craftmind-field
  ls -1dt /var/www/field-releases/* | tail -n +4 | xargs -r rm -rf
  echo live: \$(readlink /var/www/craftmind-field)"

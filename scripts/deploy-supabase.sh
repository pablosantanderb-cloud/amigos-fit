#!/bin/bash
# Aplica migraciones SQL y despliega TODAS las Edge Functions del proyecto Supabase amigos-fit.
# Uso: scripts/deploy-supabase.sh [migración.sql ...]
# Requiere el token (limitado al proyecto) en ~/.config/amigos-fit/supabase-token
set -euo pipefail
REF=cucddkvrkalkhpuvjcxm
T=$(cat ~/.config/amigos-fit/supabase-token)
API=https://api.supabase.com/v1/projects/$REF
cd "$(dirname "$0")/.."
for f in "$@"; do
  echo "→ migración $f"
  python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$f" |
    curl -sf -X POST "$API/database/query" -H "Authorization: Bearer $T" -H "Content-Type: application/json" --data @- >/dev/null
  echo "  ok"
done
for dir in supabase/functions/*/; do
  slug=$(basename "$dir")
  echo "→ desplegando $slug"
  curl -sf -X POST "$API/functions/deploy?slug=$slug" -H "Authorization: Bearer $T" \
    -F "metadata={\"entrypoint_path\":\"index.ts\",\"name\":\"$slug\",\"verify_jwt\":false};type=application/json" \
    -F "file=@${dir}index.ts;type=application/typescript" |
    python3 -c 'import json,sys;d=json.load(sys.stdin);print("  ok, versión",d["version"],d["status"])'
done

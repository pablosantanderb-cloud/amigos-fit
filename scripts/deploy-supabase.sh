#!/bin/bash
# Aplica migraciones SQL y despliega la Edge Function en el proyecto Supabase amigos-fit.
# Uso: scripts/deploy-supabase.sh [migración.sql ...]   (sin argumentos: solo despliega la función)
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
echo "→ desplegando analyze-food"
curl -sf -X POST "$API/functions/deploy?slug=analyze-food" -H "Authorization: Bearer $T" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"analyze-food","verify_jwt":false};type=application/json' \
  -F "file=@supabase/functions/analyze-food/index.ts;type=application/typescript" |
  python3 -c 'import json,sys;d=json.load(sys.stdin);print("  ok, versión",d["version"],d["status"])'

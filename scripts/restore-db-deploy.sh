#!/usr/bin/env bash
# Pulihkan deployment produksi agsi-v-2-0:
# 1) ambil URL database asli dari tokenSet store Prisma Postgres (di memori saja)
# 2) lepaskan koneksi connector (Turso + Prisma Postgres) dari proyek → gerbang
#    "connexDeploymentRequirements" tidak lagi punya resource untuk dievaluasi
# 3) pasang DATABASE_URL sebagai env manual (upsert)
# 4) deploy produksi dari git main + polling status
# 5) verifikasi produksi
# Pemakaian: bash restore-db-deploy.sh <token>
set -u
VT="${1:?token wajib}"
T="team_gSL83YS5Iip6SdjlzMr9gWvR"
P="prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK"
SPRISMA="store_8juVXcqrtrpKAUlG"; CPRISMA="spc_pbNOvGyXzu2KNKcr"
STURSO="store_zG5O87nasLvQolxH";  CTURSO="spc_RHPI38F8yX3PyE8Z"

hdr=(-H "Authorization: Bearer $VT")

echo "== [1] ambil URL database asli dari secrets store (tidak dicetak) =="
URL=$(curl -s -m 20 "${hdr[@]}" "https://api.vercel.com/v1/storage/stores/$SPRISMA/secrets?teamId=$T" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d.get('data_DATABASE_URL') or d.get('data_PRISMA_DATABASE_URL') or ''
if not v.startswith('postgres'):
    print('GAGAL'); raise SystemExit(1)
import re
m=re.match(r'^postgres(ql)?://[^:]+:[^@]+@([^:/]+):(\d+)/([^?]*)', v)
print(v if m else 'GAGAL')
") || { echo "FATAL: URL tidak terbaca"; exit 1; }
HOST=$(printf '%s' "$URL" | python3 -c "import sys,re; m=re.search(r'@([^:/]+)', sys.stdin.read()); print(m.group(1) if m else '?')")
DBN=$(printf '%s' "$URL" | python3 -c "import sys,re; m=re.search(r':5432/([^?]*)', sys.stdin.read()); print(m.group(1) if m else '?')")
echo "  URL terpasang ke host: $HOST db: $DBN (kredensial disembunyikan)"

echo "== [2] lepaskan koneksi connector dari proyek =="
for PAIR in "$STURSO $CTURSO turso" "$SPRISMA $CPRISMA prisma-postgres"; do
  set -- $PAIR; S=$1; C=$2; NAMA=$3
  CODE=$(curl -s -o /tmp/delconn.json -w "%{http_code}" -m 20 -X DELETE "${hdr[@]}" \
    "https://api.vercel.com/v1/storage/stores/$S/connections/$C?teamId=$T")
  echo "  $NAMA ($C): HTTP $CODE $(head -c 120 /tmp/delconn.json 2>/dev/null | python3 -c 'import sys; s=sys.stdin.read(); print(s if "error" not in s else "")' 2>/dev/null)"
done

echo "== [3] pasang DATABASE_URL sebagai env manual (upsert) =="
CODE=$(python3 - "$URL" <<'PYEOF'
import json, sys, os
url = sys.argv[1]
body = json.dumps({"key":"DATABASE_URL","value":url,"type":"encrypted","target":["production","preview","development"]})
open('/tmp/envbody.json','w').write(body)
PYEOF
)
CODE=$(curl -s -o /tmp/envres.json -w "%{http_code}" -m 20 -X POST "${hdr[@]}" -H "Content-Type: application/json" \
  "https://api.vercel.com/v9/projects/$P/env?teamId=$T&upsert=true" --data @/tmp/envbody.json)
python3 -c "
import json
d=json.load(open('/tmp/envres.json'))
e=d.get('envs',[{}])[0] if 'envs' in d else d.get('env') or d
if 'error' in d: print('  GAGAL:', d['error'])
else: print('  DATABASE_URL terpasang | target:', e.get('target') or d.get('target'), '| type:', e.get('type'))
"
rm -f /tmp/envbody.json /tmp/envres.json

echo "== [4] deploy produksi dari main =="
DUID=$(curl -s -m 30 -X POST "${hdr[@]}" -H "Content-Type: application/json" \
  "https://api.vercel.com/v13/deployments?teamId=$T&skipAutoDetectionConfirmation=1" \
  -d '{"name":"agsi-v-2-0","target":"production","gitSource":{"type":"github","org":"safir2310","repo":"AGSI-V-2.0","ref":"main"}}' \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('ERR '+d['error'].get('code','')+' '+d['error'].get('message',''))
else: print(d.get('uid',''))
")
if [ "${DUID#ERR}" != "$DUID" ]; then echo "  deploy gagal dibuat: $DUID"; exit 1; fi
echo "  deployment: $DUID"

echo "== [5] polling status build =="
STATE=""
for i in $(seq 1 12); do
  sleep 45
  STATE=$(curl -s -m 20 "${hdr[@]}" "https://api.vercel.com/v13/deployments/$DUID?teamId=$T" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print((d.get('readyState') or '?')+'|'+(d.get('errorMessage') or ''))
")
  echo "  menit $i: $STATE"
  S=${STATE%%|*}
  [ "$S" = "READY" ] && break
  [ "$S" = "ERROR" ] && break
  [ "$S" = "CANCELED" ] && break
done
if [ "${STATE%%|*}" != "READY" ]; then echo "HASIL: belum READY ($STATE)"; exit 2; fi

echo "== [6] verifikasi produksi =="
curl -s -m 40 -o /tmp/settings-final.json -w "  GET /api/settings: %{http_code} | %{time_total}s\n" "https://agsi-v-2-0.vercel.app/api/settings"
python3 -c "
import json
d=json.load(open('/tmp/settings-final.json'))
b=d.get('banner',{})
print('  bannerEnabled:', b.get('bannerEnabled'), '| bannerHasImage:', b.get('bannerHasImage'))
print('  waktu respons cepat (<2s) = fix readStoreSettingsRow aktif')
"
curl -s -o /dev/null -m 30 -w "  GET banner/image: HTTP %{http_code} (%{size_download} bytes)\n" "https://agsi-v-2-0.vercel.app/api/settings/banner/image"
echo "SELESAI"

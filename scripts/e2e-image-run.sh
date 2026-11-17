#!/bin/bash
# e2e-image-run.sh — regresi tampilnya gambar banner/promo END-TO-END:
# prepare SQLite → build → server → simpan semua (login+5 PUT) → RUSAKKAN
# baris seperti sisa build lama (mime+versi NULL) → verifikasi hasImage=true
# + endpoint menyajikan JPEG valid → matikan server → pulihkan client PG.
# TANPA pkill (pola "next start" di teks command line membunuh induk).
set -uo pipefail
cd /home/z/my-project
PORT=3124
DB="file:/home/z/my-project/db/e2e-test.db"

bash scripts/e2e-prepare.sh > /tmp/e2e/prep.log 2>&1 || { tail -5 /tmp/e2e/prep.log; exit 1; }
echo "prepare ✓"
DATABASE_URL="$DB" npx next build > /tmp/e2e/build.log 2>&1 || { tail -8 /tmp/e2e/build.log; exit 1; }
echo "build ✓"

setsid env DATABASE_URL="$DB" PORT=$PORT npx next start -p $PORT > /tmp/e2e/server.log 2>&1 &
SRV=$!
ready=""
for i in $(seq 1 45); do
  sleep 1
  [ "$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null)" = "200" ] && { ready=1; break; }
done
if [ -z "$ready" ]; then
  echo "server TIDAK siap"; tail -6 /tmp/e2e/server.log; kill -- -$SRV 2>/dev/null; exit 1
fi
echo "server ✓ (port $PORT)"

DATABASE_URL="$DB" node scripts/e2e-seed.mjs || { kill -- -$SRV 2>/dev/null; exit 1; }
python3 scripts/e2e-requests.py "http://localhost:$PORT" | tail -1 || { kill -- -$SRV 2>/dev/null; exit 1; }
DATABASE_URL="$DB" node scripts/e2e-image-display-check.mjs "http://localhost:$PORT"
EXIT=$?

kill -- -$SRV 2>/dev/null
rm -f db/e2e-test.db
npx prisma generate > /dev/null 2>&1
echo "== client dipulihkan ke:"; grep 'provider' node_modules/.prisma/client/schema.prisma | sed -n '2p'
exit $EXIT

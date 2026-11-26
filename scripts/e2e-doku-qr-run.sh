#!/bin/bash
# e2e-doku-qr-run.sh — uji E2E CHECKOUT GANDA DOKU (mock DOKU + SQLite lokal).
set -uo pipefail
cd /home/z/my-project
DB="file:/home/z/my-project/db/e2e-test.db"

pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "doku-mock.mjs" 2>/dev/null || true
sleep 1

bash scripts/e2e-prepare.sh || exit 1

echo "== build produksi (client SQLite)"
DATABASE_URL="$DB" npx next build 2>&1 | tail -3

echo "== start mock DOKU :3990"
node scripts/doku-mock.mjs > /tmp/doku-mock.log 2>&1 &
MOCK=$!

echo "== start server :3123 (DOKU -> mock)"
DATABASE_URL="$DB" PORT=3123 \
  DOKU_API_BASE="http://localhost:3990" \
  DOKU_CLIENT_ID="doku-e2e-client" \
  DOKU_CLIENT_SECRET="doku-e2e-secret" \
  npx next start -p 3123 > /tmp/e2e-doku-server.log 2>&1 &
SRV=$!

code=000
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/api/health 2>/dev/null || true)
  [ "$code" = "200" ] && break
done
echo "health: $code"
if [ "$code" != "200" ]; then
  echo "== server.log:"; tail -30 /tmp/e2e-doku-server.log
  kill $SRV $MOCK 2>/dev/null
  exit 1
fi

node scripts/e2e-doku-qr.mjs http://localhost:3123 http://localhost:3990; RES=$?
kill $SRV $MOCK 2>/dev/null
pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "doku-mock.mjs" 2>/dev/null || true

echo "== pulihkan prisma client Postgres"
npx prisma generate 2>&1 | tail -1

if [ "$RES" = "0" ]; then echo "E2E DOKU-QR PASS ✓"; exit 0; fi
echo "E2E DOKU-QR FAIL ✗"; exit 1

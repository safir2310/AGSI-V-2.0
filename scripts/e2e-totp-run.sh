#!/bin/bash
# e2e-totp-run.sh — uji E2E fitur "lupa password via Authenticator (TOTP)".
# prepare (schema SQLite + client) → build → server :3123 → e2e-totp.mjs
# → matikan server → pulihkan client Postgres.
set -uo pipefail
cd /home/z/my-project
DB="file:/home/z/my-project/db/e2e-test.db"

# bunuh sisa server e2e sebelumnya (kill pada npx tidak mematikan child next)
pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

bash scripts/e2e-prepare.sh || exit 1

echo "== build produksi (client SQLite)"
DATABASE_URL="$DB" npx next build 2>&1 | tail -4

echo "== start server :3123"
DATABASE_URL="$DB" PORT=3123 npx next start -p 3123 > /tmp/e2e-totp-server.log 2>&1 &
SRV=$!
mkdir -p /tmp/e2e 2>/dev/null
code=000
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/api/health 2>/dev/null || true)
  [ "$code" = "200" ] && break
done
echo "health: $code"
if [ "$code" != "200" ]; then
  echo "== server.log:"; tail -30 /tmp/e2e-totp-server.log
  kill $SRV 2>/dev/null
  exit 1
fi

node scripts/e2e-totp.mjs http://localhost:3123; RES=$?
kill $SRV 2>/dev/null
pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true

echo "== pulihkan prisma client Postgres"
npx prisma generate 2>&1 | tail -1

if [ "$RES" = "0" ]; then echo "E2E TOTP PASS ✓"; exit 0; fi
echo "E2E TOTP FAIL ✗"; exit 1

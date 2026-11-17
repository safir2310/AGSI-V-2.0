#!/bin/bash
# e2e-run.sh — jalankan uji E2E penuh: build dgn client SQLite → server
# produksi lokal :3123 → requests → verifikasi DB langsung → matikan server.
set -uo pipefail
cd /home/z/my-project
export DATABASE_URL="file:/tmp/e2e/test.db"

echo "== build produksi (client SQLite)"
npx next build 2>&1 | tail -3

echo "== start server :3123"
PORT=3123 npx next start -p 3123 > /tmp/e2e/server.log 2>&1 &
SRV=$!
code=000
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/api/health 2>/dev/null || true)
  [ "$code" = "200" ] && break
done
echo "health: $code"
if [ "$code" != "200" ]; then
  echo "== server.log:"; tail -20 /tmp/e2e/server.log
  kill $SRV 2>/dev/null
  exit 1
fi

python3 scripts/e2e-requests.py http://localhost:3123; REQ=$?
node scripts/e2e-verify.mjs; VER=$?
kill $SRV 2>/dev/null
echo "== hasil akhir: requests=$REQ verify=$VER"
if [ "$REQ" = "0" ] && [ "$VER" = "0" ]; then
  echo "E2E PASS ✓"
  exit 0
fi
exit 1

#!/bin/bash
# e2e-promo-visual.sh — uji VISUAL Panggung Promo Kinetic (mode baru strip
# "Promo Hari Ini") di beranda, dengan server lokal + SQLite segar.
set -uo pipefail
cd /home/z/my-project
DB="file:/home/z/my-project/db/e2e-test.db"

pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

bash scripts/e2e-prepare.sh || exit 1

echo "== start server :3123"
DATABASE_URL="$DB" PORT=3123 npx next start -p 3123 > /tmp/e2e-promo-server.log 2>&1 &
SRV=$!

code=000
for i in $(seq 1 60); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3123/api/health 2>/dev/null || true)
  [ "$code" = "200" ] && break
done
echo "health: $code"
if [ "$code" != "200" ]; then
  tail -25 /tmp/e2e-promo-server.log; kill $SRV 2>/dev/null; exit 1
fi

echo "== SETEL: GET /api/settings (auto-buat baris + konten default promo)"
curl -s http://localhost:3123/api/settings | python3 -c "import json,sys; d=json.load(sys.stdin); print('promoStrip:', d.get('promoStripEnabled'), '|', d.get('promoStripTitle'))" 2>/dev/null || curl -s http://localhost:3123/api/settings | head -c 300

echo "SETELA OK — lanjut ke browser (jalankan perintah agent-browser manual)"
kill $SRV 2>/dev/null
pkill -f "next start" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
echo "VISUAL PREP OK"

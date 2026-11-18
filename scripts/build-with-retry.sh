#!/bin/sh
# build-with-retry.sh — bangun produksi Vercel dengan langkah schema-extras
# TAHAN GANGGUAN (v1.3.34): node scripts/apply-pg-schema-extras.mjs sempat
# gagal 3x berturut-turut dengan P1001 "Can't reach database server at
# db.prisma.io:5432" padahal runtime sehat — koneksi build→Prisma Postgres
# sesaat terganggu. Kini langkah itu diulang maks 4x (jeda 30 dtk) sebelum
# build dinyatakan gagal; langkah lain tidak berubah.
set -e
set -a
[ -f ./.env ] && . ./.env
set +a
node scripts/copy-apk.mjs
i=1
while [ $i -le 4 ]; do
  if node scripts/apply-pg-schema-extras.mjs; then
    break
  fi
  if [ $i -eq 4 ]; then
    echo "schema-extras gagal 4x berturut-turut — deploy dibatalkan (jangan lewati: skema DB wajib sinkron)"
    exit 1
  fi
  echo "[build] schema-extras gagal (percobaan $i) — tunggu 30 dtk lalu ulangi…"
  sleep 30
  i=$((i+1))
done
next build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

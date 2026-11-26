#!/bin/sh
# build-with-retry.sh — bangun produksi Vercel — ERA SUPABASE (Postgres).
# Langkah schema-extras kembali aktif (pola era Prisma Postgres): patch SQL
# aditif di prisma/sql/*.sql diterapkan ke DATABASE_URL (Supabase) sebelum
# `next build`; P1001 (koneksi sesaat terganggu) diulang maks 4x — kegagalan
# SQL sungguhan tetap membatalkan deploy (deploy lama lebih aman).
set -e
set -a
[ -f ./.env ] && . ./.env
set +a
node scripts/copy-apk.mjs
LAST=0
i=1
while [ $i -le 4 ]; do
  if node scripts/apply-pg-schema-extras.mjs; then
    LAST=0
    break
  fi
  LAST=$?
  if [ $i -eq 4 ]; then
    break
  fi
  echo "[build] schema-extras gagal (percobaan $i) — tunggu 30 dtk lalu ulangi…"
  sleep 30
  i=$((i+1))
done
if [ "$LAST" -eq 42 ]; then
  echo "=============================================================="
  echo "WARNING: DB tak terjangkau dari build (P1001) 4x berturut-turut"
  echo "— schema-extras DILEWATI. Patch SQL idempoten harus sudah"
  echo "diterapkan di produksi. Bila commit ini MENAMBAH file SQL baru,"
  echo "deploy wajib diulang setelah koneksi pulih!"
  echo "=============================================================="
elif [ "$LAST" -ne 0 ]; then
  exit 1
fi
next build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

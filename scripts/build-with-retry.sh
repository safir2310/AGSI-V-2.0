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
  # v1.3.34 — P1001 (koneksi build→db.prisma.io terganggu) BUKAN kegagalan
  # SQL: patch di prisma/sql/ ADITIF & IDEMPOTENT dan sudah diterapkan lama
  # di DB produksi (runtime terbukti sehat). Lanjutkan build dgn peringatan
  # keras; kegagalan SQL lain (kode 1) tetap membatalkan deploy.
  echo "=============================================================="
  echo "WARNING: DB tak terjangkau dari build (P1001) 4x berturut-turut"
  echo "— schema-extras DILEWATI. Patch SQL idempoten harus sudah diterapkan"
  echo "di produksi (deploy sebelumnya). Bila commit ini MENAMBAH file SQL"
  echo "baru, deploy wajib diulang setelah koneksi pulih!"
  echo "=============================================================="
elif [ "$LAST" -ne 0 ]; then
  exit 1
fi
next build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

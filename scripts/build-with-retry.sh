#!/bin/sh
# build-with-retry.sh — bangun produksi Vercel — ERA TURSO (libSQL).
# Langkah apply-pg-schema-extras.mjs (era Prisma Postgres) DIGANTI dengan
# penyelarasan skema Turso (scripts/turso-align.mjs) yang ADITIF & IDEMPOTEN
# — best-effort: kegagalan jaringan sesaat tidak membatalkan build karena
# kolom/tabel baru sudah diterapkan sekali secara manual (turso-align.mjs).
set -e
set -a
[ -f ./.env ] && . ./.env
set +a
node scripts/copy-apk.mjs
node scripts/turso-align.mjs || echo "WARNING: turso-align gagal saat build — skema harus sudah selaras (manual). Deploy tetap dilanjutkan."
next build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/

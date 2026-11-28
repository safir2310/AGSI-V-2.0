#!/bin/bash
# test-prod-db.sh — tes koneksi DB produksi (db.prisma.io) langsung dari sandbox.
# URL diambil dari PRISMA_SETUP.md (baris DATABASE_URL=...). TIDAK mencetak URL
# atau kredensial — hanya klasifikasi hasil.
set -u
DOC="/home/z/my-project/PRISMA_SETUP.md"
URL=$(grep -oE 'postgres(ql)?://[^"]+db\.prisma\.io[^"]*' "$DOC" | head -1)
if [ -z "${URL:-}" ]; then
  echo "URL tidak ditemukan di dokumen"; exit 3
fi
mask() { sed -E 's#(postgres(ql)?://)[^@ ]+@#\1***@#g'; }
export PGPASSWORD=''
if command -v psql >/dev/null 2>&1; then
  OUT=$(echo "SELECT 1 AS alive;" | timeout 20 psql "$URL" -At 2>&1 | mask)
  RC=$?
  if [ $RC -eq 0 ] && echo "$OUT" | grep -q '^1$'; then
    echo "HASIL: DB HIDUP & OTENTIKASI OK — SELECT 1 sukses"
  else
    echo "HASIL: GAGAL (rc=$RC) — detail tersamarkan:"
    echo "$OUT" | grep -viE 'warning|psql: option' | head -6
    echo "--- klasifikasi ---"
    echo "$OUT" | grep -qiE 'password authentication|role .* does not exist|authentication failed' && echo ">> OTENTIKASI DITOLAK (URL salah/expired)"
    echo "$OUT" | grep -qiE "can't reach|could not connect|connection refused|timeout|timed out|no route" && echo ">> TIDAK TERJANGKAU (instance kemungkinan PAUSE/matol koneksi)"
    echo "$OUT" | grep -qiE 'paus|suspend|deprovision|not available|quota|limit' && echo ">> INSTANCE PAUSE/QUOTA (pesan server langsung menyebutkannya)"
  fi
else
  echo "psql tidak tersedia"
  exit 4
fi

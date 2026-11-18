#!/bin/bash
# recovery-login.sh — pemulihan sekali-jalan setelah instance db.prisma.io hidup:
#   1) probe   : GET  rute repair (bila masih P1001 → berhenti, DB belum hidup)
#   2) sinkron : POST rute repair (patch 001–011 aditif & idempoten)
#   3) verifikasi: login probe HARUS 401 (bukan 500) + /api/products 200
# Pakai: bash /home/z/my-project/scripts/recovery-login.sh
set -u
B="https://agsi-v-2-0.vercel.app"
K="sN1Qla3lN700ZuXImU2YpBz5tMVu8qQZ"
R="$B/api/admin/repair-schema?key=$K"

echo "=== [1/3] Probe DB via runtime ==="
P=$(curl -s -m 30 "$R")
if echo "$P" | grep -q "Can't reach database server"; then
  echo "DB MASIH TIDAK BISA DIHUBUNGI — aktifkan instance dulu di console.prisma.io,"
  echo "lalu jalankan skrip ini lagi (atau kabari saya)."
  exit 2
fi
if ! echo "$P" | grep -q '"columns"'; then
  echo "Respons tak terduga:"; echo "$P" | head -c 300; echo; exit 1
fi
echo "DB HIDUP — kolom User saat ini: $(echo "$P" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["columns"]), "kolom; missing:", d["missing"])')"

echo "=== [2/3] Terapkan patch skema (001–011, aditif & idempoten) ==="
A=$(curl -s -m 120 -X POST "$R")
echo "$A" | python3 -c '
import json,sys
d=json.load(sys.stdin)
if d.get("ok"):
    for a in d["applied"]:
        print(f"  {a[\"file\"]:28s} {a[\"statements\"]} pernyataan" + (" — ada yang dilewati (sudah ada)" if a.get("skipped") else ""))
    print("missing setelah patch:", d["missing"])
else:
    print("GAGAL:", json.dumps(d)[:400])'

echo "=== [3/3] Verifikasi login & endpoint ==="
L=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -X POST "$B/api/auth/login" -H "Content-Type: application/json" -d '{"email":"__probe__@x","password":"x"}')
PR=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "$B/api/products")
S=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "$B/api/settings")
echo "login(probe)=${L}  products=${PR}  settings=${S}"
if [ "$L" = "401" ] && [ "$PR" = "200" ]; then
  echo "✅ LOGIN SEHAT KEMBALI (401 = logika login normal, hanya kredensial yang memang salah)."
  echo "Catatan: rute sementara /api/admin/repair-schema masih ter-deploy — dihapus pada deploy bersih berikutnya."
  exit 0
fi
echo "❌ Masih bermasalah — laporkan hasil di atas."
exit 1

#!/bin/bash
# Uji end-to-end: perbaikan bug "silahkan login" di keranjang + alur lupa password
set -e
BASE="http://localhost:3000"
EMAIL="test-lupa@agsi.test"
PASS_LAMA="pass123456"
PASS_BARU="geprek789"

echo "===== 1. Daftar akun uji ====="
REG=$(curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"name\":\"Tester Lupa\",\"email\":\"$EMAIL\",\"password\":\"$PASS_LAMA\",\"phone\":\"08123\"}")
echo "$REG" | head -c 300; echo
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
[ -n "$TOKEN" ] && echo "OK: token diterima (${#TOKEN} chars)" || { echo "GAGAL: token kosong"; exit 1; }

echo ""
echo "===== 2. BUG ASLI: POST /api/orders TANPA cookie, hanya Bearer token ====="
PROD=$(curl -s "$BASE/api/products" | python3 -c "import sys,json; p=json.load(sys.stdin)['products'][0]; print(p['id'])")
ORDER=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"items\":[{\"productId\":\"$PROD\",\"qty\":2}],\"type\":\"TAKEAWAY\",\"paymentMethod\":\"CASH\",\"source\":\"APP\"}")
CODE=$(echo "$ORDER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('order',{}).get('code', d.get('error','GAGAL')))")
echo "Hasil pesanan: $CODE"

echo ""
echo "===== 3. GET /api/auth/me dengan Bearer saja ====="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/auth/me" | python3 -c "import sys,json; u=json.load(sys.stdin)['user']; print('OK: terlogin sebagai', u['name'], '/', u['role'])"

echo ""
echo "===== 4. Lupa password langkah 1: minta kode ====="
FORGOT=$(curl -s -X POST "$BASE/api/auth/forgot-password" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\"}")
echo "$FORGOT" | python3 -m json.tool
DEVCODE=$(echo "$FORGOT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('devCode',''))")

echo ""
echo "===== 5. Reset dengan kode SALAH (harus ditolak) ====="
curl -s -X POST "$BASE/api/auth/reset-password" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"000000\",\"newPassword\":\"$PASS_BARU\"}" | head -c 200; echo

echo ""
echo "===== 6. Reset dengan kode BENAR ====="
curl -s -X POST "$BASE/api/auth/reset-password" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$DEVCODE\",\"newPassword\":\"$PASS_BARU\"}" | head -c 200; echo

echo ""
echo "===== 7. Token lama harus mati (sesi dihapus) ====="
curl -s -o /dev/null -w "GET /api/orders dengan token lama: HTTP %{http_code} (harus 401)\n" \
  -H "Authorization: Bearer $TOKEN" "$BASE/api/orders?scope=mine"

echo ""
echo "===== 8. Login password LAMA (harus gagal) ====="
curl -s -o /dev/null -w "HTTP %{http_code} (harus 401)" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_LAMA\"}"; echo

echo ""
echo "===== 9. Login password BARU (harus sukses) ====="
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_BARU\"}")
TOKEN2=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
[ -n "$TOKEN2" ] && echo "OK: login baru sukses, token baru diterima" || { echo "GAGAL"; echo "$LOGIN"; exit 1; }

echo ""
echo "===== 10. Pesan lagi dengan token baru (alur lengkap) ====="
ORDER2=$(curl -s -X POST "$BASE/api/orders" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN2" \
  -d "{\"items\":[{\"productId\":\"$PROD\",\"qty\":1}],\"type\":\"DINE_IN\",\"tableNo\":\"09\",\"paymentMethod\":\"QRIS\",\"source\":\"APP\"}")
echo "$ORDER2" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK: pesanan', d.get('order',{}).get('code'), 'total', d.get('order',{}).get('total'))"

echo ""
echo "===== 11. Cookie harus SameSite=None; Secure saat HTTPS (simulasi proxy) ====="
curl -s -D - -o /dev/null -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" -H "X-Forwarded-Proto: https" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_BARU\"}" | rg -i "set-cookie"

echo ""
echo "===== 12. Logout dengan Bearer (sesi dihapus dari DB) ====="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE/api/auth/logout" -H "Authorization: Bearer $TOKEN2"
curl -s -o /dev/null -w "Token setelah logout: HTTP %{http_code} (harus 401)\n" \
  -H "Authorization: Bearer $TOKEN2" "$BASE/api/orders?scope=mine"

echo ""
echo "SEMUA UJI SELESAI ✓"

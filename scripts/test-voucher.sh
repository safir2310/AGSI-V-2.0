#!/usr/bin/env bash
# Tes end-to-end fitur voucher AYAM GEPREK SAMBAL IJO
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { # $1 deskripsi, $2 kondisi (0/1)
  if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1"; fi
}

jsonget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

echo "== 1. Login pelanggan (budi) =="
RES=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"budi@example.com","password":"user123"}')
BUDI_TOKEN=$(echo "$RES" | jsonget "['token']")
[ -n "$BUDI_TOKEN" ] && [ "$BUDI_TOKEN" != "None" ]; check "login budi dapat token" $?

echo "== 2. Login admin =="
RES=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@agsi.test","password":"admin123"}')
ADMIN_TOKEN=$(echo "$RES" | jsonget "['token']")
[ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ]; check "login admin dapat token" $?

AUTH_BUDI="Authorization: Bearer $BUDI_TOKEN"
AUTH_ADMIN="Authorization: Bearer $ADMIN_TOKEN"

echo "== 3. Daftar voucher pelanggan =="
RES=$(curl -s "$BASE/api/vouchers" -H "$AUTH_BUDI")
COUNT=$(echo "$RES" | jsonget "['vouchers']" | python3 -c "import sys;print(len(sys.stdin.read().split()))" 2>/dev/null)
N=$(echo "$RES" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['vouchers']))")
[ "$N" -ge 3 ]; check "GET /api/vouchers menampilkan >= 3 voucher (dapat $N)" $?

echo "== 4. Ambil produk untuk pesanan =="
RES=$(curl -s "$BASE/api/products")
PID=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin)['products'][0]['id'])")
PPRICE=$(echo "$RES" | python3 -c "import sys,json;print(json.load(sys.stdin)['products'][0]['price'])")
[ -n "$PID" ]; check "produk tersedia ($PID, harga $PPRICE)" $?

echo "== 5. Tukar kode GEPREK10 (subtotal 30000 → potongan 3000) =="
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d '{"code":"geprek10","subtotal":30000}')
DISC=$(echo "$RES" | jsonget "['discount']")
[ "$DISC" = "3000" ]; check "potongan 10% dari 30000 = 3000 (dapat $DISC)" $?

echo "== 6. Subtotal di bawah minimum (20000 < 25000) =="
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d '{"code":"GEPREK10","subtotal":20000}')
ERR=$(echo "$RES" | jsonget "['error']")
echo "$ERR" | rg -qi "minimal"; check "ditolak dengan pesan minimal belanja ($ERR)" $?

echo "== 7. Kode salah =="
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d '{"code":"NGACO123","subtotal":50000}')
ERR=$(echo "$RES" | jsonget "['error']")
echo "$ERR" | rg -qi "tidak ditemukan"; check "kode salah ditolak ($ERR)" $?

echo "== 8. Buat pesanan dengan voucher GEPREK10 =="
# qty = 6 item agar subtotal ~ >= 25000
QTY=6
SUBTOTAL=$((PPRICE * QTY))
EXPECTED=$((SUBTOTAL - SUBTOTAL / 10))
RES=$(curl -s -X POST "$BASE/api/orders" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d "{\"customerName\":\"Tes Voucher\",\"items\":[{\"productId\":\"$PID\",\"qty\":$QTY}],\"type\":\"DINE_IN\",\"tableNo\":\"99\",\"paymentMethod\":\"CASH\",\"source\":\"APP\",\"voucherCode\":\"GEPREK10\"}")
ORDER_ID=$(echo "$RES" | jsonget "['order']['id']")
VCODE=$(echo "$RES" | jsonget "['order']['voucherCode']")
VDISC=$(echo "$RES" | jsonget "['order']['voucherDiscount']")
OTOTAL=$(echo "$RES" | jsonget "['order']['total']")
[ "$VCODE" = "GEPREK10" ]; check "order.voucherCode = GEPREK10" $?
[ "$VDISC" = "$((SUBTOTAL / 10))" ]; check "order.voucherDiscount = $((SUBTOTAL/10)) (dapat $VDISC)" $?
[ "$OTOTAL" = "$EXPECTED" ]; check "order.total = $EXPECTED (dapat $OTOTAL)" $?

echo "== 9. Pakai GEPREK10 lagi (harus ditolak — sekali pakai) =="
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d '{"code":"GEPREK10","subtotal":50000}')
ERR=$(echo "$RES" | jsonget "['error']")
echo "$ERR" | rg -qi "sudah pernah"; check "pemakaian kedua ditolak ($ERR)" $?
RES=$(curl -s -X POST "$BASE/api/orders" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d "{\"customerName\":\"Tes Voucher\",\"items\":[{\"productId\":\"$PID\",\"qty\":2}],\"type\":\"TAKEAWAY\",\"source\":\"APP\",\"voucherCode\":\"GEPREK10\"}")
ERR=$(echo "$RES" | jsonget "['error']")
echo "$ERR" | rg -qi "sudah pernah"; check "order kedua dengan kode sama ditolak ($ERR)" $?

echo "== 10. Voucher kuota 1 (SEKALIPAKAI) =="
SUBTOTAL2=$((PPRICE * 8))
EXPECTED2=$((SUBTOTAL2 - 15000))
RES=$(curl -s -X POST "$BASE/api/orders" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d "{\"customerName\":\"Tes Voucher\",\"items\":[{\"productId\":\"$PID\",\"qty\":8}],\"type\":\"TAKEAWAY\",\"source\":\"APP\",\"voucherCode\":\"SEKALIPAKAI\"}")
ORDER2_ID=$(echo "$RES" | jsonget "['order']['id']")
VDISC2=$(echo "$RES" | jsonget "['order']['voucherDiscount']")
[ "$VDISC2" = "15000" ]; check "potongan SEKALIPAKAI 15000 (dapat $VDISC2)" $?

# user lain tidak boleh memakai (kuota habis)
RES=$(curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"email\":\"voucher-test-$RANDOM@agsi.test\",\"password\":\"test12345\",\"name\":\"Tester Voucher\"}")
T2=$(echo "$RES" | jsonget "['token']")
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "Authorization: Bearer $T2" -H "Content-Type: application/json" \
  -d '{"code":"SEKALIPAKAI","subtotal":50000}')
ERR=$(echo "$RES" | jsonget "['error']")
echo "$ERR" | rg -qi "habis"; check "user lain ditolak karena kuota habis ($ERR)" $?

echo "== 11. Admin: daftar semua voucher =="
RES=$(curl -s "$BASE/api/vouchers?scope=all" -H "$AUTH_ADMIN")
USED=$(echo "$RES" | python3 -c "import sys,json;vs=json.load(sys.stdin)['vouchers'];print([v['usedCount'] for v in vs if v['code']=='GEPREK10'][0])")
[ "$USED" = "1" ]; check "usedCount GEPREK10 = 1 di data admin (dapat $USED)" $?
# pelanggan biasa tidak boleh scope=all
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/vouchers?scope=all" -H "$AUTH_BUDI")
[ "$CODE" = "403" ]; check "scope=all ditolak untuk pelanggan (HTTP $CODE)" $?

echo "== 12. Admin: buat voucher baru =="
RES=$(curl -s -X POST "$BASE/api/vouchers" -H "$AUTH_ADMIN" -H "Content-Type: application/json" \
  -d '{"code":"TESTAJA","title":"Voucher Uji Coba","type":"FIXED","value":2000,"minPurchase":10000,"quota":5}')
NEWID=$(echo "$RES" | jsonget "['voucher']['id']")
[ -n "$NEWID" ] && [ "$NEWID" != "None" ]; check "voucher TESTAJA dibuat ($NEWID)" $?
# kode duplikat ditolak
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/vouchers" -H "$AUTH_ADMIN" -H "Content-Type: application/json" \
  -d '{"code":"TESTAJA","title":"Duplikat","type":"FIXED","value":2000}')
[ "$CODE" = "400" ]; check "kode duplikat ditolak (HTTP $CODE)" $?
# pelanggan tidak boleh buat voucher
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/vouchers" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d '{"code":"CURANG","title":"Mencoba","type":"FIXED","value":999999}')
[ "$CODE" = "403" ]; check "pelanggan tidak bisa membuat voucher (HTTP $CODE)" $?

echo "== 13. Admin: edit & nonaktifkan voucher =="
RES=$(curl -s -X PUT "$BASE/api/vouchers/$NEWID" -H "$AUTH_ADMIN" -H "Content-Type: application/json" \
  -d '{"isActive":false}')
ACT=$(echo "$RES" | jsonget "['voucher']['isActive']")
[ "$ACT" = "False" ]; check "TESTAJA dinonaktifkan" $?
# voucher nonaktif tidak bisa ditukar
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "Authorization: Bearer $T2" -H "Content-Type: application/json" \
  -d '{"code":"TESTAJA","subtotal":50000}')
ERR=$(echo "$RES" | jsonget "['error']")
echo "$ERR" | rg -qi "tidak aktif|tidak ditemukan"; check "voucher nonaktif tidak bisa ditukar ($ERR)" $?

echo "== 14. Batalkan pesanan → voucher dikembalikan =="
RES=$(curl -s -X PUT "$BASE/api/orders/$ORDER2_ID" -H "$AUTH_ADMIN" -H "Content-Type: application/json" \
  -d '{"status":"CANCELLED"}')
ST=$(echo "$RES" | jsonget "['order']['status']")
[ "$ST" = "CANCELLED" ]; check "pesanan SEKALIPAKAI dibatalkan" $?
RES=$(curl -s "$BASE/api/vouchers?scope=all" -H "$AUTH_ADMIN")
USED=$(echo "$RES" | python3 -c "import sys,json;vs=json.load(sys.stdin)['vouchers'];print([v['usedCount'] for v in vs if v['code']=='SEKALIPAKAI'][0])")
REMAIN=$(echo "$RES" | python3 -c "import sys,json;vs=json.load(sys.stdin)['vouchers'];print([v['remaining'] for v in vs if v['code']=='SEKALIPAKAI'][0])")
[ "$USED" = "0" ]; check "usedCount SEKALIPAKAI kembali 0 setelah dibatalkan (dapat $USED)" $?
[ "$REMAIN" = "1" ]; check "kuota SEKALIPAKAI dikembalikan (remaining $REMAIN)" $?
# budi bisa pakai lagi setelah refund
RES=$(curl -s -X POST "$BASE/api/vouchers/apply" -H "$AUTH_BUDI" -H "Content-Type: application/json" \
  -d '{"code":"SEKALIPAKAI","subtotal":50000}')
DISC=$(echo "$RES" | jsonget "['discount']")
[ -n "$DISC" ] && [ "$DISC" != "None" ]; check "SEKALIPAKAI bisa dipakai lagi setelah refund" $?

echo "== 15. Hapus voucher uji =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/vouchers/$NEWID" -H "$AUTH_ADMIN")
[ "$CODE" = "200" ]; check "voucher TESTAJA dihapus (HTTP $CODE)" $?

echo ""
echo "================================"
echo "LULUS: $PASS  GAGAL: $FAIL"
[ $FAIL -eq 0 ] && echo "SEMUA TES LULUS ✓" || echo "ADA TES GAGAL ✗"

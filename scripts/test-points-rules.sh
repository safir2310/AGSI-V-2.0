#!/bin/bash
# Uji aturan poin baru: earn Rp 15.000 → 100 poin, redeem 1 poin = Rp 1
set -u
BASE="http://localhost:3000"
JAR_B="/tmp/pts_budi.jar"
JAR_A="/tmp/pts_admin.jar"
rm -f "$JAR_B" "$JAR_A"

login() { # login <jar> <email> <pass>
  curl -s -c "$1" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$2\",\"password\":\"$3\"}" | head -c 300; echo
}

echo "=== 1. Login budi & admin ==="
login "$JAR_B" "budi@example.com" "user123" | tail -c 120
login "$JAR_A" "admin@agsi.test" "admin123" | tail -c 120

echo; echo "=== 2. Kartu member budi (field baru) ==="
curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('points      :', d.get('points'))
print('memberCode  :', d.get('memberCode'))
print('earnStep    :', d.get('earnStep'), '(harus 15000)')
print('earnStepPts :', d.get('earnStepPoints'), '(harus 100)')
print('redeemUnit  :', d.get('redeemUnitPoints'), 'poin = Rp', d.get('redeemUnitValue'), '(harus 100 = Rp 100)')
print('minRedeem   :', d.get('minRedeem'))
print('tiers       :', [(t['id'], t['points'], t['value']) for t in d.get('tiers', [])])
"

echo; echo "=== 3. Redeem di bawah minimum ({points: 50}) — harus 400 ==="
curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
  -d '{"points": 50}' -w " [HTTP %{http_code}]"; echo

echo; echo "=== 4. Redeem tier tak dikenal — harus 400 ==="
curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
  -d '{"tierId": "P250"}' -w " [HTTP %{http_code}]"; echo

echo; echo "=== 5. Buat pesanan budi (2 item, total ≥ 15.000) ==="
PROD=$(curl -s "$BASE/api/products" | python3 -c "
import json,sys
ps = json.load(sys.stdin)
ps = [p for p in (ps if isinstance(ps, list) else ps.get('products', [])) if p.get('available')]
print(json.dumps([{'productId': p['id'], 'qty': 2} for p in ps[:2]]))
")
echo "items: $PROD"
curl -s -b "$JAR_B" -X POST "$BASE/api/orders" -H 'Content-Type: application/json' \
  -d "{\"type\":\"DINE_IN\",\"tableNo\":\"9\",\"items\":$PROD}" > /tmp/pts_order.json
ORDER_ID=$(python3 -c "import json; print(json.load(open('/tmp/pts_order.json')).get('id',''))")
ORDER_TOTAL=$(python3 -c "import json; print(json.load(open('/tmp/pts_order.json')).get('total',0))")
ORDER_CODE=$(python3 -c "import json; print(json.load(open('/tmp/pts_order.json')).get('code',''))")
echo "order: $ORDER_CODE id=$ORDER_ID total=$ORDER_TOTAL"

PTS_BEFORE=$(curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "import json,sys; print(json.load(sys.stdin)['points'])")
echo "poin budi sebelum: $PTS_BEFORE"

echo; echo "=== 6. Tandai pesanan LUNAS (tunai oleh kasir/admin) lalu SELESAI ==="
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"paymentStatus":"PAID"}' -w " [bayar HTTP %{http_code}]"; echo
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' -w " [selesai HTTP %{http_code}]"; echo

EXPECTED=$(python3 -c "print( ($ORDER_TOTAL // 15000) * 100 )")
PTS_AFTER=$(curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "import json,sys; print(json.load(sys.stdin)['points'])")
DELTA=$((PTS_AFTER - PTS_BEFORE))
echo "poin budi sesudah: $PTS_AFTER (delta $DELTA, diharapkan $EXPECTED dari total $ORDER_TOTAL)"
[ "$DELTA" -eq "$EXPECTED" ] && echo "PASS: earn Rp 15.000 → 100 poin ✓" || echo "FAIL: earn salah ✗"

echo; echo "=== 7. Redeem tier P100 — voucher harus Rp 100 ==="
curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
  -d '{"tierId": "P100"}' | tee /tmp/pts_redeem1.json | python3 -c "
import json,sys
d = json.load(sys.stdin)
v = d.get('voucher', {})
print('voucher:', v.get('code'), 'value:', v.get('value'), '(harus 100) points:', v.get('points'))
print('sisa poin:', d.get('points'))
"

echo; echo "=== 8. Redeem SEMUA saldo — voucher = jumlah poin rupiah ==="
SISA=$(python3 -c "import json; print(json.load(open('/tmp/pts_redeem1.json')).get('points', 0))")
if [ "$SISA" -lt 100 ]; then
  echo "sisa poin ($SISA) < 100 → beri 250 poin dulu via pesanan? gunakan redeem minimal saja"
  curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
    -d '{"points": 100}' -w " [HTTP %{http_code}]"; echo
else
  curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
    -d "{\"points\": $SISA}" | python3 -c "
import json,sys
d = json.load(sys.stdin)
v = d.get('voucher', {})
print('voucher:', v.get('code'), 'value:', v.get('value'), '(harus = poin ditukar)', 'points:', v.get('points'))
print('sisa poin:', d.get('points'), '(harus 0)')
"
fi

echo; echo "=== 9. Voucher hasil tukar tampil di kartu member ==="
curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('saldo akhir :', d['points'])
print('riwayat     :')
for t in d['transactions'][:4]:
    print('  ', t['type'], t['points'], '-', t['description'])
print('voucher     :')
for v in d['vouchers'][:4]:
    print('  ', v['code'], 'Rp', v['value'], '(dari', v['points'], 'poin)', 'used:', v['used'])
"

echo; echo "=== 10. Idempoten: tandai selesai LAGI — poin tidak boleh dobel ==="
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' -o /dev/null -w " [HTTP %{http_code}]"; echo
PTS_FINAL=$(curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "import json,sys; print(json.load(sys.stdin)['points'])")
echo "poin setelah re-complete: $PTS_FINAL (harus sama dengan saldo akhir sebelumnya)"

#!/bin/bash
# Lanjutan uji: selesaikan pesanan, verifikasi poin masuk, redeem tier & semua
set -u
BASE="http://localhost:3000"
JAR_B="/tmp/pts_budi.jar"; JAR_A="/tmp/pts_admin.jar"

pts() { curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "import json,sys; print(json.load(sys.stdin)['points'])"; }

ORDER_ID="cmw20p5dr001lsnyg6elf9xrn"
ORDER_TOTAL=62000
EXPECTED=400   # floor(62000/15000)*100

echo "=== A. Pesanan PENDING → PREPARING → READY → bayar tunai → COMPLETED ==="
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"status":"PREPARING"}' -o /dev/null -w "preparing: HTTP %{http_code}\n"
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"status":"READY"}' -o /dev/null -w "ready: HTTP %{http_code}\n"
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"paymentStatus":"PAID"}' -o /tmp/pay.json -w "bayar: HTTP %{http_code}\n"
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' -o /tmp/done.json -w "selesai: HTTP %{http_code}\n"

B=$(pts); echo "poin budi: 70 + $EXPECTED = harus 470 → sekarang: $B"
[ "$B" -eq 470 ] && echo "PASS: poin masuk saat pesanan selesai ✓" || echo "FAIL ✗"

echo; echo "=== B. Idempoten — selesaikan LAGI, poin tidak boleh dobel ==="
curl -s -b "$JAR_A" -X PUT "$BASE/api/orders/$ORDER_ID" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' -o /dev/null -w "re-complete: HTTP %{http_code}\n"
B2=$(pts); echo "poin tetap: $B2"
[ "$B2" -eq 470 ] && echo "PASS: idempoten ✓" || echo "FAIL ✗"

echo; echo "=== C. Redeem tier P100 → voucher Rp 100 ==="
curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
  -d '{"tierId":"P100"}' | python3 -c "
import json,sys
d = json.load(sys.stdin)
v = d.get('voucher',{})
ok = v.get('value') == 100 and v.get('points') == 100 and d.get('points') == 370
print('voucher:', v.get('code'), '| value:', v.get('value'), '| poin dipakai:', v.get('points'), '| sisa:', d.get('points'))
print('PASS ✓' if ok else 'FAIL ✗')
"

echo; echo "=== D. Redeem SEMUA saldo (370) → voucher Rp 370 ==="
curl -s -b "$JAR_B" -X POST "$BASE/api/member/redeem" -H 'Content-Type: application/json' \
  -d '{"points": 370}' | python3 -c "
import json,sys
d = json.load(sys.stdin)
v = d.get('voucher',{})
ok = v.get('value') == 370 and v.get('points') == 370 and d.get('points') == 0
print('voucher:', v.get('code'), '| value:', v.get('value'), '| poin dipakai:', v.get('points'), '| sisa:', d.get('points'))
print('PASS ✓' if ok else 'FAIL ✗')
"

echo; echo "=== E. Voucher hasil tukar bisa dipakai di keranjang? (cek validasi) ==="
CODE=$(curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(d['vouchers'][0]['code'] if d['vouchers'] else '')
")
echo "kode voucher terbaru: $CODE"
curl -s -b "$JAR_B" "$BASE/api/vouchers/validate?code=$CODE" -w " [HTTP %{http_code}]"; echo

echo; echo "=== F. Kartu member final ==="
curl -s -b "$JAR_B" "$BASE/api/member/card" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('saldo :', d['points'])
print('riwayat terbaru:')
for t in d['transactions'][:3]:
    print('  ', t['type'], t['points'], '—', t['description'])
print('voucher budi:')
for v in d['vouchers'][:3]:
    print('  ', v['code'], 'Rp', v['value'], '| dari', v['points'], 'poin | used:', v['used'])
"

#!/bin/bash
# Uji: edit profil (PUT /api/auth/me) + kelola kasir (/api/cashiers)
set -u
BASE="http://localhost:3000"
A=/tmp/t_admin.jar; C=/tmp/t_cashier.jar; B=/tmp/t_budi.jar
rm -f "$A" "$C" "$B"

echo "=== 1. Login admin & budi ==="
curl -s -c "$A" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@agsi.test","password":"admin123"}' -o /dev/null -w "admin login: %{http_code}\n"
curl -s -c "$B" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"budi@example.com","password":"user123"}' -o /dev/null -w "budi login: %{http_code}\n"

echo; echo "=== 2. Edit profil budi (nama + no HP) ==="
curl -s -b "$B" -X PUT $BASE/api/auth/me -H 'Content-Type: application/json' \
  -d '{"name":"Budi Santoso","phone":"0812-9999-8888"}' | python3 -c "
import json,sys
u = json.load(sys.stdin).get('user', {})
print('nama :', u.get('name'), '| hp:', u.get('phone'))
print('PASS ✓' if u.get('name')=='Budi Santoso' and u.get('phone')=='0812-9999-8888' else 'FAIL ✗')
"

echo; echo "=== 3. Ganti password TANPA password sekarang — harus 400 ==="
curl -s -b "$B" -X PUT $BASE/api/auth/me -H 'Content-Type: application/json' \
  -d '{"name":"Budi Santoso","newPassword":"user456"}' -w " [HTTP %{http_code}]"; echo

echo; echo "=== 4. Ganti password dengan password sekarang SALAH — harus 400 ==="
curl -s -b "$B" -X PUT $BASE/api/auth/me -H 'Content-Type: application/json' \
  -d '{"name":"Budi Santoso","currentPassword":"ngasal","newPassword":"user456"}' -w " [HTTP %{http_code}]"; echo

echo; echo "=== 5. Ganti password BENAR ==="
curl -s -b "$B" -X PUT $BASE/api/auth/me -H 'Content-Type: application/json' \
  -d '{"name":"Budi Santoso","currentPassword":"user123","newPassword":"user456"}' -w " [HTTP %{http_code}]"; echo

echo; echo "=== 6. Login dengan password baru ==="
curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"budi@example.com","password":"user456"}' -o /dev/null -w "login user456: %{http_code} (harus 200)\n"
# kembalikan password lama agar tes lain tidak rusak
curl -s -b "$B" -X PUT $BASE/api/auth/me -H 'Content-Type: application/json' \
  -d '{"name":"Budi Santoso","currentPassword":"user456","newPassword":"user123"}' -o /dev/null -w "reset ke user123: %{http_code}\n"

echo; echo "=== 7. Cashiers: akses non-admin harus 403 ==="
curl -s -b "$B" $BASE/api/cashiers -w " [HTTP %{http_code}]"; echo

echo; echo "=== 8. Cashiers: daftar (admin) ==="
curl -s -b "$A" $BASE/api/cashiers | python3 -c "
import json,sys
cs = json.load(sys.stdin).get('cashiers', [])
print('jumlah kasir:', len(cs))
for c in cs: print('  -', c['name'], '|', c['email'])
"

echo; echo "=== 9. Tambah kasir baru ==="
curl -s -b "$A" -X POST $BASE/api/cashiers -H 'Content-Type: application/json' \
  -d '{"name":"Sari Mulyani","email":"sari@agsi.test","phone":"0813-2222-3333","password":"sari12345"}' \
  | python3 -c "
import json,sys
c = json.load(sys.stdin).get('cashier', {})
print('dibuat:', c.get('name'), '|', c.get('email'), '| hp:', c.get('phone'))
CID = c.get('id','')
open('/tmp/t_cid.txt','w').write(CID)
print('PASS ✓' if c.get('name')=='Sari Mulyani' else 'FAIL ✗')
"

echo; echo "=== 10. Duplikat email — harus 409 ==="
curl -s -b "$A" -X POST $BASE/api/cashiers -H 'Content-Type: application/json' \
  -d '{"name":"Sari Dua","email":"sari@agsi.test","password":"sari12345"}' -w " [HTTP %{http_code}]"; echo

echo; echo "=== 11. Login kasir baru → langsung role CASHIER ==="
curl -s -c "$C" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sari@agsi.test","password":"sari12345"}' | python3 -c "
import json,sys
d = json.load(sys.stdin)
u = d.get('user', {})
print('login:', u.get('name'), '| role:', u.get('role'))
print('PASS ✓' if u.get('role')=='CASHIER' else 'FAIL ✗')
"

echo; echo "=== 12. Edit kasir + reset password (admin) ==="
CID=$(cat /tmp/t_cid.txt)
curl -s -b "$A" -X PUT $BASE/api/cashiers/$CID -H 'Content-Type: application/json' \
  -d '{"name":"Sari Mulyani S.E.","phone":"0813-4444-5555","password":"sari99999"}' \
  | python3 -c "
import json,sys
c = json.load(sys.stdin).get('cashier', {})
print('update:', c.get('name'), '| hp:', c.get('phone'))
print('PASS ✓' if c.get('name')=='Sari Mulyani S.E.' else 'FAIL ✗')
"

echo; echo "=== 13. Password lama kasir tidak bisa dipakai; password baru bisa ==="
curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sari@agsi.test","password":"sari12345"}' -o /dev/null -w "lama sari12345: %{http_code} (harus 401)\n"
curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sari@agsi.test","password":"sari99999"}' -o /dev/null -w "baru sari99999: %{http_code} (harus 200)\n"

echo; echo "=== 14. Hapus kasir ==="
curl -s -b "$A" -X DELETE $BASE/api/cashiers/$CID -w " [HTTP %{http_code}]"; echo
curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sari@agsi.test","password":"sari99999"}' -o /dev/null -w "login setelah dihapus: %{http_code} (harus 401)\n"
curl -s -b "$A" $BASE/api/cashiers | python3 -c "
import json,sys
print('jumlah kasir sekarang:', len(json.load(sys.stdin).get('cashiers', [])))
"

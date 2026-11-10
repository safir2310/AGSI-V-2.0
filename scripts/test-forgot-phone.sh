#!/bin/bash
# Test: lupa password verifikasi 6 angka terakhir no. HP
set -e
cd /home/z/my-project
BASE=http://localhost:3000

(bun run dev > /tmp/dev.log 2>&1 &)
for i in $(seq 1 60); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" $BASE/api/products 2>/dev/null | grep -q 200; then break; fi
done
echo "== server ready =="

echo ""
echo "=== 1. forgot-password budi (harap: phoneHint 0812 •••• ••••, TANPA devCode) ==="
R1=$(curl -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" -d '{"email":"budi@example.com"}')
echo "$R1"
echo "$R1" | grep -q "devCode" && echo "FAIL: masih ada devCode!" || echo "PASS: tidak ada devCode"
echo "$R1" | grep -q '"phoneHint":"0812 •••• ••••"' && echo "PASS: phoneHint benar" || echo "FAIL: phoneHint salah"

echo ""
echo "=== 2. reset dengan angka SALAH (123456) ==="
R2=$(curl -s -X POST $BASE/api/auth/reset-password -H "Content-Type: application/json" -d '{"email":"budi@example.com","code":"123456","newPassword":"barupass1"}')
echo "$R2"
echo "$R2" | grep -q "tidak cocok" && echo "PASS: ditolak dengan pesan tidak cocok" || echo "FAIL: pesan salah"

echo ""
echo "=== 3. minta sesi baru lalu reset dengan angka BENAR (998888) ==="
curl -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" -d '{"email":"budi@example.com"}' > /dev/null
R3=$(curl -s -X POST $BASE/api/auth/reset-password -H "Content-Type: application/json" -d '{"email":"budi@example.com","code":"998888","newPassword":"barupass1"}')
echo "$R3"
echo "$R3" | grep -q '"ok":true' && echo "PASS: password diganti" || echo "FAIL: gagal reset"

echo ""
echo "=== 4. login dengan password baru ==="
R4=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"email":"budi@example.com","password":"barupass1"}')
echo "$R4" | head -c 200; echo ""
echo "$R4" | grep -q '"token"' && echo "PASS: login sukses" || echo "FAIL: login gagal"

echo ""
echo "=== 5. login dengan password LAMA harus gagal ==="
R5=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"email":"budi@example.com","password":"user123"}')
echo "$R5" | head -c 150; echo ""
echo "$R5" | grep -q '"token"' && echo "FAIL: password lama masih bisa" || echo "PASS: password lama ditolak"

echo ""
echo "=== 6. kembalikan password budi ke user123 ==="
curl -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" -d '{"email":"budi@example.com"}' > /dev/null
R6=$(curl -s -X POST $BASE/api/auth/reset-password -H "Content-Type: application/json" -d '{"email":"budi@example.com","code":"998888","newPassword":"user123"}')
echo "$R6"
R6b=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d '{"email":"budi@example.com","password":"user123"}')
echo "$R6b" | grep -q '"token"' && echo "PASS: password user123 dipulihkan" || echo "FAIL: pemulihan gagal"

echo ""
echo "=== 7. register TANPA no. HP harus ditolak ==="
R7=$(curl -s -X POST $BASE/api/auth/register -H "Content-Type: application/json" -d '{"name":"Tes Tanpa HP","email":"tanpahp@test.local","password":"rahasia1"}')
echo "$R7"
echo "$R7" | grep -q "No. HP wajib" && echo "PASS: register tanpa HP ditolak" || echo "FAIL: register tanpa HP lolos"

echo ""
echo "=== 8. email tidak terdaftar ==="
R8=$(curl -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" -d '{"email":"hantu@test.local"}')
echo "$R8"
echo "$R8" | grep -q "belum terdaftar" && echo "PASS: email tak dikenal ditolak" || echo "FAIL"

echo ""
echo "=== 9. register DENGAN no. HP lalu lupa password pakai 6 angka terakhirnya ==="
R9=$(curl -s -X POST $BASE/api/auth/register -H "Content-Type: application/json" -d '{"name":"Tes Verifikasi","email":"verif@test.local","password":"rahasia1","phone":"0857-1234-5678"}')
echo "$R9" | head -c 120; echo ""
R9b=$(curl -s -X POST $BASE/api/auth/forgot-password -H "Content-Type: application/json" -d '{"email":"verif@test.local"}')
echo "$R9b"
echo "$R9b" | grep -q '"phoneHint":"0857 •••• ••••"' && echo "PASS: hint register-an baru benar" || echo "FAIL: hint salah"
R9c=$(curl -s -X POST $BASE/api/auth/reset-password -H "Content-Type: application/json" -d '{"email":"verif@test.local","code":"345678","newPassword":"rahasia2"}')
echo "$R9c"
echo "$R9c" | grep -q '"ok":true' && echo "PASS: reset user baru sukses (345678)" || echo "FAIL: reset user baru gagal"

echo ""
echo "== SEMUA TEST SELESAI =="

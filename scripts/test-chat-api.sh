#!/usr/bin/env bash
# Uji API Chat CS (pelanggan ↔ admin) — 18 skenario
cd /home/z/my-project

PASS=0; FAIL=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1";
  else FAIL=$((FAIL+1)); echo "  ✗ $1 — harap=$2 dapat=$3"; fi
}

API=http://localhost:3000

# --- login helper ---
login() { # email pass -> echoes token
  curl -s -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.token||'')})"
}

echo "== LOGIN =="
BUDI=$(login budi@example.com user123)
ADMIN=$(login admin@agsi.test admin123)
KASIR=$(login kasir@agsi.test kasir123)
check "login budi"    "ok" "$([ -n "$BUDI" ] && echo ok)"
check "login admin"   "ok" "$([ -n "$ADMIN" ] && echo ok)"
check "login kasir"   "ok" "$([ -n "$KASIR" ] && echo ok)"

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
body() { curl -s "$@"; }

echo "== SKENARIO CHAT =="
# S1: tanpa login
check "S1 GET /api/chat tanpa auth → 401" 401 "$(code $API/api/chat)"
# S2: budi belum punya utas
check "S2 GET chat budi (kosong) → []" "[]" "$(body -H "Authorization: Bearer $BUDI" $API/api/chat | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(d).messages)))")"
# S3: pesan kosong
check "S3 POST pesan kosong → 400" 400 "$(code -X POST -H "Authorization: Bearer $BUDI" -H "Content-Type: application/json" -d '{"body":"   "}' $API/api/chat)"
# S3b: pesan > 500 char
LONG=$(node -e "process.stdout.write('a'.repeat(501))")
check "S3b POST pesan 501 char → 400" 400 "$(code -X POST -H "Authorization: Bearer $BUDI" -H "Content-Type: application/json" -d "{\"body\":\"$LONG\"}" $API/api/chat)"
# S4: budi kirim pesan pertama
R=$(body -X POST -H "Authorization: Bearer $BUDI" -H "Content-Type: application/json" -d '{"body":"Halo, paket geprek mozarella masih ada?"}' $API/api/chat)
check "S4 budi kirim pesan → 201" 201 "$(code -X POST -H "Authorization: Bearer $BUDI" -H "Content-Type: application/json" -d '{"body":"Test dup"}' $API/api/chat)" # (pesan tambahan utk jumlah)
BUDI_ID=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).user.id))" <<< '{"user":{"id":"'"$(body -H "Authorization: Bearer $BUDI" $API/api/chat/unread >/dev/null; echo)"'"}}' 2>/dev/null)
# ambil id budi via login response
BUDI_ID=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d '{"email":"budi@example.com","password":"user123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).user.id))")
# S5: unread admin = 2 (dua pesan budi)
check "S5 unread admin = 2" "unread=2" "unread=$(body -H "Authorization: Bearer $ADMIN" $API/api/chat/unread | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).unread)))")"
# S6: daftar utas admin berisi budi
LIST=$(body -H "Authorization: Bearer $ADMIN" $API/api/chat)
check "S6 admin lihat daftar utas" "Budi Santoso|2" "$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const t=j.threads.find(x=>x.email==='budi@example.com');process.stdout.write(t?t.name+'|'+t.unreadAdmin:'NOT_FOUND')})" <<< "$LIST")"
THREAD_ID=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const t=j.threads.find(x=>x.email==='budi@example.com');process.stdout.write(t?t.id:'')})" <<< "$LIST")
# S7: admin balas tanpa userId
check "S7 admin POST tanpa userId → 400" 400 "$(code -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{"body":"Halo"}' $API/api/chat)"
# S8: admin balas userId fiktif
check "S8 admin POST userId fiktif → 404" 404 "$(code -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{"body":"Halo","userId":"tidakada"}' $API/api/chat)"
# S9: threadId fiktif
check "S9 GET threadId fiktif → 404" 404 "$(code -H "Authorization: Bearer $ADMIN" "$API/api/chat?threadId=tidakada")"
# S10: admin balas
check "S10 admin balas budi → 201" 201 "$(code -X POST -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d "{\"body\":\"Masih ada kak, silakan order sebelum jam 9 malam ya 😊\",\"userId\":\"$BUDI_ID\"}" $API/api/chat)"
# S11: unread budi = 1
check "S11 unread budi = 1" "unread=1" "unread=$(body -H "Authorization: Bearer $BUDI" $API/api/chat/unread | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).unread)))")"
# S12: budi membaca → 3 pesan (2 budi + 1 admin), unread reset
M=$(body -H "Authorization: Bearer $BUDI" $API/api/chat)
check "S12 budi baca chat → 3 pesan" "3|CS" "$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const last=j.messages[j.messages.length-1];process.stdout.write(j.messages.length+'|'+((last.senderRole==='ADMIN'||last.senderRole==='OWNER')?'CS':'X'))})" <<< "$M")"
check "S12b unread budi reset → 0" "unread=0" "unread=$(body -H "Authorization: Bearer $BUDI" $API/api/chat/unread | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).unread)))")"
# S13: budi coba kirim dengan userId admin → tetap ke utas sendiri
check "S13 budi POST dgn userId → 201 (diabaikan)" 201 "$(code -X POST -H "Authorization: Bearer $BUDI" -H "Content-Type: application/json" -d "{\"body\":\"Oke terima kasih!\",\"userId\":\"$ADMIN\"}" $API/api/chat)"
# S14: admin buka thread → unreadAdmin utas reset, pesan 4
T=$(body -H "Authorization: Bearer $ADMIN" "$API/api/chat?threadId=$THREAD_ID")
check "S14 admin buka utas → 4 pesan" "4" "$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).messages.length)))" <<< "$T")"
check "S14b unread admin setelah baca → 0" "unread=0" "unread=$(body -H "Authorization: Bearer $ADMIN" $API/api/chat/unread | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).unread)))")"
# S15: kasir juga bisa chat
check "S15 kasir kirim chat → 201" 201 "$(code -X POST -H "Authorization: Bearer $KASIR" -H "Content-Type: application/json" -d '{"body":"Laporan: printer struk macet"}' $API/api/chat)"
# S16: kasir muncul di daftar admin
check "S16 kasir ada di daftar utas admin" "2" "$(body -H "Authorization: Bearer $ADMIN" $API/api/chat | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).threads.length)))")"
# S17: pelanggan tidak bisa lihat daftar utas (param threadId diabaikan)
check "S17 budi GET ?threadId → utas sendiri" "4" "$(body -H "Authorization: Bearer $BUDI" "$API/api/chat?threadId=$THREAD_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).messages.length)))")"
# S18: unread endpoint tanpa auth
check "S18 unread tanpa auth → 401" 401 "$(code $API/api/chat/unread)"

echo
echo "HASIL: $PASS lulus, $FAIL gagal"
[ "$FAIL" = "0" ]

#!/usr/bin/env bash
# E2E alur LUPA PASSWORD via OTP EMAIL (Resend) — lihat EMAIL_SETUP.md
# Daftar user uji → minta OTP → cooldown → OTP salah ditolak → OTP benar
# reset sukses → OTP reuse ditolak → login password baru OK → password lama
# ditolak → cleanup. Jalankan: bash scripts/test-forgot-otp.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="http://localhost:3000"
EMAIL="forgot-otp-$(date +%s)@agsi.test"
PASS_BARU="rahasia-baru-7"
OTP_LOG=".otp-dev.log"

step() { echo; echo "== $1"; }

step "1) Daftar user uji ($EMAIL)"
curl -sf -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"name\":\"Uji OTP\",\"email\":\"$EMAIL\",\"password\":\"awal-123\",\"phone\":\"081298760000\"}" >/dev/null
echo "   ✓ terdaftar"

step "2) Minta OTP (POST /api/auth/forgot-password)"
RESP=$(curl -sf -X POST "$BASE/api/auth/forgot-password" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\"}")
echo "   → $RESP"
OTP=$(tail -n 40 "$OTP_LOG" | awk -F'\t' -v e="$EMAIL" '$2==e {c=$3} END {print c}')
[ -n "${OTP:-}" ] || { echo "   ✗ OTP tidak ditemukan di $OTP_LOG"; exit 1; }
echo "   ✓ OTP tercatat: $OTP"

step "3) Cooldown — minta OTP lagi harus ditolak (429)"
CODE=$(curl -s -o /tmp/otp-cool.json -w "%{http_code}" -X POST "$BASE/api/auth/forgot-password" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\"}")
[ "$CODE" = "429" ] && echo "   ✓ 429 — $(head -c 120 /tmp/otp-cool.json)" || { echo "   ✗ HTTP $CODE"; exit 1; }

step "4) OTP salah harus ditolak (400)"
CODE=$(curl -s -o /tmp/otp-wrong.json -w "%{http_code}" -X POST "$BASE/api/auth/reset-password" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"code\":\"000000\",\"newPassword\":\"$PASS_BARU\"}")
[ "$CODE" = "400" ] && echo "   ✓ 400 — $(head -c 140 /tmp/otp-wrong.json)" || { echo "   ✗ HTTP $CODE"; exit 1; }

step "5) OTP benar — reset password sukses"
curl -sf -X POST "$BASE/api/auth/reset-password" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$OTP\",\"newPassword\":\"$PASS_BARU\"}" >/dev/null
echo "   ✓ password diganti"

step "6) OTP yang sama tidak bisa dipakai ulang (400)"
CODE=$(curl -s -o /tmp/otp-reuse.json -w "%{http_code}" -X POST "$BASE/api/auth/reset-password" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"code\":\"$OTP\",\"newPassword\":\"lain-888\"}")
[ "$CODE" = "400" ] && echo "   ✓ 400 — $(head -c 140 /tmp/otp-reuse.json)" || { echo "   ✗ HTTP $CODE"; exit 1; }

step "7) Login dengan password BARU harus sukses"
TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS_BARU\"}" | jq -r .token)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo "   ✓ login OK (token diterima)" || { echo "   ✗ login gagal"; exit 1; }

step "8) Login dengan password LAMA harus gagal (401)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"awal-123\"}")
[ "$CODE" = "401" ] && echo "   ✓ 401" || { echo "   ✗ HTTP $CODE"; exit 1; }

step "9) Bersih-bersih data uji"
EMAIL="$EMAIL" bunx tsx scripts/cleanup-forgot-otp-test.ts

echo
echo "✅ SEMUA TES LULUS (8/8)"

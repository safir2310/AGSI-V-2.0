#!/bin/bash
# Uji integrasi QRIS DANA end-to-end secara lokal:
#   1. Generate keypair RSA uji (merchant + DANA) di /tmp/dana-test-keys
#   2. Suntik env DANA_* ke .env (DANA_API_BASE -> server mock 127.0.0.1:4653)
#   3. Restart dev server agar env terbaca
#   4. Jalankan scripts/test-qris-dana.ts (server DANA mock in-process)
#   5. PULIHKAN .env + restart dev server (supaya deploy lokal bersih)
# Keluar dengan exit code test.
set -u
cd "$(dirname "$0")/.." || exit 1

KEYS=/tmp/dana-test-keys
ENV_BACKUP=/tmp/.env.backup-dana-test

# ---------- 1) Kunci uji ----------
rm -rf "$KEYS"; mkdir -p "$KEYS"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS/merchant-private.pem" 2>/dev/null
openssl rsa -in "$KEYS/merchant-private.pem" -pubout -out "$KEYS/merchant-public.pem" 2>/dev/null
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS/dana-private.pem" 2>/dev/null
openssl rsa -in "$KEYS/dana-private.pem" -pubout -out "$KEYS/dana-public.pem" 2>/dev/null
if [ ! -s "$KEYS/merchant-private.pem" ] || [ ! -s "$KEYS/dana-private.pem" ]; then
  echo "✗ Gagal generate kunci RSA (openssl?)" >&2; exit 1
fi
join_pem() { # PEM utuh -> satu baris dengan literal \n (untuk .env)
  sed ':a;N;$!ba;s/\n/\\n/g' "$1"
}
MERCHANT_PRIV_ONELINE="$(join_pem "$KEYS/merchant-private.pem")"
DANA_PUB_ONELINE="$(join_pem "$KEYS/dana-public.pem")"

# ---------- 2) Suntik env DANA ke .env ----------
cp .env "$ENV_BACKUP"
# Hapus blok DANA lama bila ada (dari uji sebelumnya)
sed -i '/^# --- DANA TEST BLOCK ---$/,$d' .env
cat >> .env <<EOF
# --- DANA TEST BLOCK ---
DANA_CLIENT_ID=TEST-CLIENT-ID
DANA_MERCHANT_ID=216660000274111177110
DANA_STORE_ID=TEST-STORE-001
DANA_API_BASE=http://127.0.0.1:4653
DANA_PRIVATE_KEY=$MERCHANT_PRIV_ONELINE
DANA_PUBLIC_KEY=$DANA_PUB_ONELINE
EOF

cleanup() {
  cp "$ENV_BACKUP" .env
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
  sleep 2
  (setsid nohup bash scripts/dev-server.sh > /tmp/agsi-dev-restart.log 2>&1 < /dev/null &)
}
trap cleanup EXIT

# ---------- 3) Restart dev server ----------
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 3
(setsid nohup bash scripts/dev-server.sh > /tmp/agsi-dev-restart.log 2>&1 < /dev/null &)
for i in $(seq 1 20); do
  sleep 3
  if curl -s -o /dev/null -m 3 http://127.0.0.1:3000/api/health; then break; fi
done
curl -s -m 3 http://127.0.0.1:3000/api/health > /dev/null || { echo "✗ Dev server tidak hidup"; exit 1; }

# ---------- 4) Jalankan test (server mock in-process) ----------
# NB: TIDAK sourcing .env (baris PEM berisi spasi membuat bash protes).
# Bun memuat .env sendiri untuk test & prisma.
echo "===== MULAI TEST QRIS DANA ====="
bun scripts/test-qris-dana.ts
TEST_CODE=$?

# ---------- 5) cleanup (trap) ----------
exit $TEST_CODE

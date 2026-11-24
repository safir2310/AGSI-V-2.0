#!/bin/bash
# resume_after_billing.sh — jalankan SEMUA tahap tersisa setelah metode pembayaran
# ditambahkan di dashboard Vercel (Settings → Billing, tim safir-mfr-s-projects).
# Pemakaian: bash scripts/resume_after_billing.sh
set -e
cd /home/z/my-project
DOMAIN="ayamgepreksambalijo.com"

echo "== [1/3] Beli domain $DOMAIN (registrar Vercel) + daftar Resend + record DNS =="
if node scripts/buy_and_register_domain.mjs "$DOMAIN"; then
  echo "Tahap 1 beres."
else
  RC=$?
  if [ "$RC" = "3" ]; then
    # order dibuat tapi skrip lama keluar salah — ambil orderId terakhir & lanjut
    echo "Order sudah dibuat — lanjut polling/status…"
  else
    exit $RC
  fi
fi

echo "== [2/3] Verifikasi domain di Resend + RESEND_FROM + redeploy + probe =="
node scripts/resend_verify_new.mjs "$DOMAIN"

echo "== [3/3] Selesai. Situs: https://ayamgepreksambalijo.vercel.app dan https://$DOMAIN =="

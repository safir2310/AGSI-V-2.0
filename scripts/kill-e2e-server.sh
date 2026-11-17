#!/bin/bash
# kill-e2e-server.sh — matikan server E2E :3123 TANPA mengenai proses induk
# (pkill -f "next start" dijalankan langsung dari command line membunuh bash
# itu sendiri karena teks perintahnya mengandung pola — jadi dipisah ke file).
pkill -f "next start" 2>/dev/null
sleep 1
exit 0

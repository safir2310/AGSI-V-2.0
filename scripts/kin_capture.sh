#!/usr/bin/env bash
# Rekam satu siklus adegan kurir di Beranda (server dev lokal) untuk verifikasi
# visual animasi tipografi kinetik. Hasil: kin.webm + rect.json (posisi strip).
# Pakai: bash scripts/kin_capture.sh [url] [dir_output]
set -u
URL="${1:-http://localhost:3111/}"
OUT_DIR="${2:-/home/z/my-project/scripts/tmp/kin}"
mkdir -p "$OUT_DIR"

agent-browser set viewport 390 844
agent-browser open "$URL"
agent-browser wait --load networkidle
agent-browser wait 1500

echo "=== rect section[aria-hidden] (x,y,w,h):"
agent-browser eval "JSON.stringify([...document.querySelectorAll('section[aria-hidden]')].map(s=>{const r=s.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}))" \
  | tee "$OUT_DIR/rect.raw"

echo "=== ukuran viewport / dpr:"
agent-browser eval "JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})"

echo "=== page errors:"
agent-browser errors
echo "=== console (20 baris terakhir):"
agent-browser console | tail -20

# Rekaman memakai konteks baru + memuat ulang halaman → siklus animasi dimulai
# bersamaan dengan awal video (8 dtk siklus + sisa).
agent-browser record start "$OUT_DIR/kin.webm"
agent-browser wait 9500
agent-browser record stop
agent-browser close
ls -la "$OUT_DIR"

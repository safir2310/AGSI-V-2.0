#!/usr/bin/env bash
# Verifikasi lokal adegan kurir Beranda (satu perintah, tanpa proses tersisa):
#   1. salin HomeView.tsx terbaru ke worktree sekali-pakai scripts/tmp/wt-kin
#   2. nyalakan server dev di port 3111 HANYA selama verifikasi
#   3. cuplik garis waktu animasi dari DOM (scripts/kin_timeline.js) → laporan
#      (scripts/kin_timeline_report.py)
#   4. [hanya lebar 390] rekam 1 siklus + bingkai kunci area strip untuk
#      pemeriksaan visual (scripts/kin_keysheet.py)
#   5. mode reduced-motion: semua elemen harus statis (scripts/kin_static.js +
#      scripts/kin_static_check.py)
#   6. matikan server
# Prasyarat worktree wt-kin: dibuat dari origin/main + rute /kin-test + stub
# leaflet (lihat next.config.ts di worktree). Dijalankan TANPA .env → API gagal
# dengan aman dan tidak pernah menyentuh database produksi.
# Pakai: bash scripts/kin_verify_local.sh [lebar_viewport_px]
set -u
ROOT=/home/z/my-project
VW="${1:-390}"
WT="$ROOT/scripts/tmp/wt-kin"
URL="http://localhost:3111/kin-test"
if [ "$VW" = "390" ]; then OUT="$ROOT/scripts/tmp/kin"; else OUT="$ROOT/scripts/tmp/kin-$VW"; fi
LOG="$ROOT/scripts/tmp/kin-dev.log"
FAIL=0
mkdir -p "$OUT"
[ -d "$WT/src/app/kin-test" ] || { echo "worktree verifikasi belum siap: $WT"; exit 2; }
if ss -ltn 2>/dev/null | grep -q ":3111"; then echo "port 3111 masih terpakai"; exit 2; fi
cp "$ROOT/src/components/customer/HomeView.tsx" "$WT/src/components/customer/HomeView.tsx"

(cd "$WT" && npx next dev --webpack -p 3111) > "$LOG" 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null; pkill -f "next dev --webpack -p 3111" 2>/dev/null' EXIT

code=000
for i in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 60 "$URL" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "server dev: status $URL = $code (viewport $VW px)"
[ "$code" = "200" ] || { tail -15 "$LOG" | cut -c1-200; exit 3; }

# --- 3. cuplikan garis waktu (2 siklus) ---
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser open "$URL" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1200 >/dev/null 2>&1
echo "mulai cuplikan: $(agent-browser eval "$(cat "$ROOT/scripts/kin_timeline.js")")"
R="pending"
for i in $(seq 1 14); do
  sleep 2
  R=$(agent-browser eval "window.__kin" 2>&1)
  case "$R" in *pending*) ;; *) break;; esac
done
echo "error halaman: $(agent-browser errors 2>&1 | head -3)"
agent-browser close >/dev/null 2>&1
echo "$R" > "$OUT/timeline.raw"
echo "cuplikan: $(wc -c < "$OUT/timeline.raw") byte (poll ke-$i)"
python "$ROOT/scripts/kin_timeline_report.py" "$OUT/timeline.raw" || FAIL=1

# --- 4. rekaman 1 siklus + bingkai kunci (hanya untuk lebar 390) ---
# Rekaman memakai konteks baru; halaman dibuka ulang tepat sebelum rekaman agar
# siklus animasi mulai sedekat mungkin dengan awal video (detektor awal siklus
# di kin_keysheet.py tetap mencari transisi wipe secara mandiri). Posisi strip
# diukur pada sesi yang sama.
if [ "$VW" = "390" ]; then
  rm -f "$OUT"/keys/key_*.png
  agent-browser set viewport 390 844 >/dev/null 2>&1
  agent-browser open "$URL" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait 1000 >/dev/null 2>&1
  agent-browser eval "JSON.stringify([...document.querySelectorAll('section[aria-hidden]')].map(s=>{const r=s.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}))" > "$OUT/rect.raw"
  agent-browser open "$URL" >/dev/null 2>&1
  agent-browser record start "$OUT/kin.webm" >/dev/null 2>&1
  agent-browser wait 12000 >/dev/null 2>&1
  agent-browser record stop >/dev/null 2>&1
  agent-browser close >/dev/null 2>&1
  python "$ROOT/scripts/kin_keysheet.py" "$OUT/kin.webm" "$OUT/rect.raw" "$OUT/keys" || FAIL=1
fi

# --- 5. reduced-motion: dua cuplikan (jarak 1,5 dtk) harus identik & statis ---
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser set media light reduced-motion >/dev/null 2>&1
agent-browser open "$URL" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
S1=$(agent-browser eval "$(cat "$ROOT/scripts/kin_static.js")" 2>&1)
agent-browser wait 1500 >/dev/null 2>&1
S2=$(agent-browser eval "$(cat "$ROOT/scripts/kin_static.js")" 2>&1)
agent-browser close >/dev/null 2>&1
echo "--- reduced-motion:"
python "$ROOT/scripts/kin_static_check.py" "$S1" "$S2" || FAIL=1

# --- 6. rute konfigurasi kustom (kin-test2): gaya + garis waktu cfg lain ---
# cfg kustom: teks "Promo Spesial Hari Ini", font mono, bold, tanpa KAPITAL,
# italic, 12px, violet/aksen merah, GAYA 3D flip3d, siklus 6 dtk, BOOM mati.
URL2="http://localhost:3111/kin-test2"
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser open "$URL2" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1200 >/dev/null 2>&1
agent-browser eval "$(cat "$ROOT/scripts/kin_styles.js")" > "$OUT/styles.raw"
echo "--- gaya konfigurasi kustom:"
echo "mulai cuplikan kustom: $(agent-browser eval "$(cat "$ROOT/scripts/kin_timeline.js")")"
R2="pending"
for i in $(seq 1 14); do
  sleep 2
  R2=$(agent-browser eval "window.__kin" 2>&1)
  case "$R2" in *pending*) ;; *) break;; esac
done
agent-browser close >/dev/null 2>&1
echo "$R2" > "$OUT/timeline2.raw"
echo "cuplikan kustom: $(wc -c < "$OUT/timeline2.raw") byte"
python "$ROOT/scripts/kin_custom_report.py" "$OUT/styles.raw" "$OUT/timeline2.raw" || FAIL=1

# --- 7. sheet admin (kin-admin): buka menu "Animasi Beranda" → tangkap layar ---
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser open "http://localhost:3111/kin-admin" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1200 >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Animasi Beranda'))?.click()" >/dev/null 2>&1
agent-browser wait 1800 >/dev/null 2>&1
agent-browser screenshot "$OUT/anim-sheet.png" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
echo "tangkapan sheet: $(wc -c < "$OUT/anim-sheet.png") byte → $OUT/anim-sheet.png"

# --- 8. popup banner (kin-popup): lebih kecil & tanpa teks PROMO ---
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser open "http://localhost:3111/kin-popup" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 2200 >/dev/null 2>&1
PINFO=$(agent-browser eval "(()=>{const d=document.querySelector('[aria-label=\"Banner promo\"]');if(!d)return JSON.stringify({error:'popup tidak tampil'});const c=d.querySelector(':scope > div');const r=c.getBoundingClientRect();const promo=[...d.querySelectorAll('span')].filter(s=>s.textContent.trim().toLowerCase()==='promo').length;return JSON.stringify({w:+r.width.toFixed(1),h:+r.height.toFixed(1),promo:promo})})()" 2>&1)
echo "popup: $PINFO"
agent-browser screenshot "$OUT/banner-popup.png" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
echo "tangkapan popup: $(wc -c < "$OUT/banner-popup.png") byte → $OUT/banner-popup.png"
python "$ROOT/scripts/kin_popup_check.py" "$PINFO" "$VW" || FAIL=1

# --- 9. AGSI MOTION STUDIO: efek runtime di DOM (rute /kin-motion) ---
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser open "http://localhost:3111/kin-motion" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 350 >/dev/null 2>&1
M1=$(agent-browser eval "(()=>{const hw=[...document.querySelectorAll('h1 span')].filter(s=>typeof s.className==='string'&&s.className.includes('inline-block'));const c0=[...document.querySelectorAll('button.card-lift')][0];const cs0=c0?getComputedStyle(c0):null;const cw=hw[0]?getComputedStyle(hw[0]):null;return JSON.stringify({heroWords:hw.length,heroOp:cw?+(+cw.opacity).toFixed(2):-1,heroTf:cw?cw.transform.slice(0,60):'none',cards:[...document.querySelectorAll('button.card-lift')].length,cardTf:cs0?cs0.transform.slice(0,60):'none'})})()" 2>&1)
agent-browser wait 2200 >/dev/null 2>&1
M2=$(agent-browser eval "(()=>{const hw=[...document.querySelectorAll('h1 span')].filter(s=>typeof s.className==='string'&&s.className.includes('inline-block'));const c0=[...document.querySelectorAll('button.card-lift')][0];const cs0=c0?getComputedStyle(c0):null;const cw=hw[0]?getComputedStyle(hw[0]):null;return JSON.stringify({heroWords:hw.length,heroOp:cw?+(+cw.opacity).toFixed(2):-1,heroTf:cw?cw.transform.slice(0,60):'none',cards:[...document.querySelectorAll('button.card-lift')].length,cardTf:cs0?cs0.transform.slice(0,60):'none'})})()" 2>&1)
agent-browser screenshot "$OUT/motion-home.png" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
echo "--- motion studio runtime:"
python "$ROOT/scripts/kin_motion_check.py" "$M1" "$M2" || FAIL=1
echo "tangkapan beranda motion: $(wc -c < "$OUT/motion-home.png") byte → $OUT/motion-home.png"

# --- 10. sheet studio admin (kin-admin): menu + pratinjau + inspector ---
agent-browser set viewport "$VW" 844 >/dev/null 2>&1
agent-browser open "http://localhost:3111/kin-admin" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('AGSI Motion Studio'))?.click()" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
agent-browser screenshot "$OUT/motion-studio-top.png" >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('p')].find(p=>p.textContent.includes('Target Animasi'))?.scrollIntoView({block:'start'})" >/dev/null 2>&1
agent-browser wait 600 >/dev/null 2>&1
agent-browser eval "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Kartu Produk'))?.click()" >/dev/null 2>&1
agent-browser wait 800 >/dev/null 2>&1
agent-browser screenshot "$OUT/motion-studio-targets.png" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
echo "tangkapan studio: $(wc -c < "$OUT/motion-studio-top.png") byte → $OUT/motion-studio-top.png | $(wc -c < "$OUT/motion-studio-targets.png") byte → $OUT/motion-studio-targets.png"

[ "$FAIL" = "0" ] && echo "SEMUA PEMERIKSAAN LULUS" || echo "ADA PEMERIKSAAN GAGAL"
exit $FAIL

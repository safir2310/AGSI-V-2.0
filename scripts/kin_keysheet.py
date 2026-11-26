"""Ambil bingkai kunci dari rekaman kurir Beranda (hanya area strip, diperbesar)
untuk diperiksa secara visual (mis. lewat model vision).

Awal siklus animasi di video dicari otomatis: bingkai pertama yang memuat
kapsul putih spanduk di atas jalan aspal (wipe mulai = fase 1,3 dtk), lalu
tiap bingkai kunci diambil pada fase yang diinginkan.

Pakai: python scripts/kin_keysheet.py <kin.webm> <rect.raw> <dir_output> [fase_dtk ...]
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

OPEN_T = 1.35  # fase (dtk) saat kapsul putih baru mulai terlihat
webm, rect_raw, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
phases = [float(p) for p in sys.argv[4:]] or [0.7, 1.7, 2.3, 2.9, 3.75, 4.3, 5.6, 6.1]
out_dir.mkdir(parents=True, exist_ok=True)
tmp = out_dir / "_scan"
tmp.mkdir(exist_ok=True)
for old in tmp.glob("*.png"):
    old.unlink()

data = json.loads(rect_raw.read_text().strip())
if isinstance(data, str):
    data = json.loads(data)
cands = [r for r in data if 60 <= r["h"] <= 100 and r["w"] > 300] or data
rect = min(cands, key=lambda r: abs(r["h"] - 80))

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(webm), "-frames:v", "1", str(tmp / "probe.png")], check=True)
W, H = Image.open(tmp / "probe.png").size
sc = W / (2 * rect["x"] + rect["w"])  # skala piksel video terhadap px CSS


def px(v):
    return int(round(v * sc))


# Pindai SELURUH video @10 fps: hitung piksel putih kapsul per bingkai. Awal
# siklus = transisi "tutup → buka" pertama yang tumbuh bertahap (bingkai putih
# pertama setelah ≥ 0,3 dtk tanpa kapsul, dan putihnya masih sedikit ≤ 400 px —
# kalau halaman kebetulan dirender saat kapsul sudah terbuka penuh, jumlah
# putihnya melonjak ~4000 px dan tidak dihitung sebagai awal wipe). Transisi itu
# = fase WIPE_START pada garis waktu animasi.
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(webm), "-vf", "fps=10", str(tmp / "s_%03d.png")], check=True)
OPEN_T = 1.35  # fase (dtk) saat kapsul putih baru mulai terlihat
offset = None
run_closed = 0
for i, f in enumerate(sorted(tmp.glob("s_*.png"))):
    im = Image.open(f).convert("RGB")
    road = im.crop((px(rect["x"] + 10), px(rect["y"] + 58), px(rect["x"] + 250), px(rect["y"] + 72)))
    pill = im.crop((px(rect["x"] + 20), px(rect["y"] + 30), px(rect["x"] + 270), px(rect["y"] + 56)))
    road_dark = sum(1 for p in road.getdata() if max(p) < 110)
    pill_white = sum(1 for p in pill.getdata() if min(p) >= 250)
    if road_dark <= 200 or pill_white <= 40:
        run_closed += 1  # halaman belum termuat, atau kapsul sedang tertutup
        continue
    if run_closed >= 3 and pill_white <= 400:
        nxt = im  # pastikan putihnya memang tumbuh (wipe), bukan lompatan render
        f2 = f.parent / f"s_{int(f.stem[2:]) + 1:03d}.png"
        if f2.exists():
            nxt = Image.open(f2).convert("RGB")
            p2 = nxt.crop((px(rect["x"] + 20), px(rect["y"] + 30), px(rect["x"] + 270), px(rect["y"] + 56)))
            if sum(1 for p in p2.getdata() if min(p) >= 250) > pill_white:
                offset = i / 10 - OPEN_T
                break
            run_closed = 0
            continue
        offset = i / 10 - OPEN_T
        break
    run_closed = 0
if offset is None:
    offset = 0.7
    print("PERINGATAN: awal siklus tidak terdeteksi, pakai asumsi offset 0,7 dtk")
print(f"video {W}x{H}px (skala {sc:.2f}), strip css x={rect['x']:.0f} y={rect['y']:.0f} w={rect['w']:.0f} h={rect['h']:.0f}, "
      f"awal siklus di video t={offset:.1f}s")

x0, x1 = max(0, px(rect["x"]) - 6), min(W, px(rect["x"] + rect["w"]) + 6)
y0, y1 = max(0, px(rect["y"]) - 12), min(H, px(rect["y"] + rect["h"]) + 12)
S = 2.5

for ph in phases:
    t = offset + ph
    raw = tmp / f"raw_{ph:.2f}.png"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(webm), "-frames:v", "1", str(raw)],
        check=False,
    )
    if not raw.exists():
        print(f"fase {ph:.2f}s (video {t:.1f}s): tidak ada bingkai")
        continue
    crop = Image.open(raw).convert("RGB").crop((x0, y0, x1, y1))
    crop = crop.resize((int(crop.width * S), int(crop.height * S)), Image.LANCZOS)
    dst = out_dir / f"key_ph{ph:04.1f}s.png"
    crop.save(dst)
    raw.unlink()
    hist = crop.convert("L").histogram()
    print(f"fase {ph:.2f}s (video {t:.1f}s) -> {dst.name} {crop.size} non-white {1 - hist[255] / sum(hist):.2f}")
for f in tmp.glob("*.png"):
    f.unlink()
tmp.rmdir()

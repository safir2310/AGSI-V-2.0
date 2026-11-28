"""Susun bingkai rekaman kurir Beranda menjadi satu montase untuk dicek visual.

Pakai: python scripts/kin_montage.py <kin.webm> <rect.raw> <montage.png> [fps]
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

webm, rect_raw, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
fps = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0

frames_dir = webm.parent / "frames"
frames_dir.mkdir(exist_ok=True)
for old in frames_dir.glob("*.png"):
    old.unlink()
subprocess.run(
    ["ffmpeg", "-v", "error", "-y", "-i", str(webm), "-vf", f"fps={fps}", str(frames_dir / "f%03d.png")],
    check=True,
)
frames = sorted(frames_dir.glob("f*.png"))
if not frames:
    sys.exit("tidak ada bingkai terekam")

# Posisi strip jalan: section aria-hidden setinggi ±72px
# (keluaran agent-browser eval berupa string JSON yang di-encode lagi)
data = json.loads(rect_raw.read_text().strip())
if isinstance(data, str):
    data = json.loads(data)
rect = min(data, key=lambda r: abs(r["h"] - 72))

first = Image.open(frames[0])
W, H = first.size
x0, x1 = max(0, int(rect["x"]) - 4), min(W, int(rect["x"] + rect["w"]) + 4)
y0, y1 = max(0, int(rect["y"]) - 8), min(H, int(rect["y"] + rect["h"]) + 8)

S = 1.6
LABEL = 18
cols = 2
tw, th = int((x1 - x0) * S), int((y1 - y0) * S)
rows = (len(frames) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + LABEL)), "white")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
for i, f in enumerate(frames):
    im = Image.open(f).convert("RGB").crop((x0, y0, x1, y1)).resize((tw, th), Image.LANCZOS)
    cx, cy = (i % cols) * tw, (i // cols) * (th + LABEL)
    draw.text((cx + 4, cy + 1), f"t = {i / fps:.1f}s", fill="black", font=font)
    sheet.paste(im, (cx, cy + LABEL))

sheet.save(out)
gray = sheet.convert("L")
hist = gray.histogram()
print(f"video {W}x{H}, strip x{x0}-{x1} y{y0}-{y1}, {len(frames)} bingkai")
print(f"montase {sheet.size} -> {out}  non-white {1 - hist[255] / sum(hist):.2f}")

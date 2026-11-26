"""Periksa rute konfigurasi kustom (kin-test2): cfg = teks "Promo Spesial Hari
Ini", font mono, weight bold, caps nonaktif, italic, ukuran 12px, warna teks
violet + aksen merah, siklus 6 dtk, BOOM mati.

Pakai: python scripts/kin_custom_report.py <styles.raw> <timeline2.raw>
"""
import json
import re
import statistics
import sys
from pathlib import Path


def load(p):
    s = Path(p).read_text().strip()
    try:
        d = json.loads(s)
    except json.JSONDecodeError:
        d = json.loads(s[s.find("{") : s.rfind("}") + 1])
    return json.loads(d) if isinstance(d, str) else d


styles = load(sys.argv[1])
if "error" in styles:
    sys.exit(f"ERROR dari halaman: {styles['error']}")
print(f"gaya: {json.dumps(styles, ensure_ascii=False)}")

num = float
raw = Path(sys.argv[2]).read_text().strip()
data = json.loads(raw)
if isinstance(data, str):
    data = json.loads(data)
if "error" in data:
    sys.exit(f"ERROR dari halaman: {data['error']}")
strip_w = data["stripW"]
rows = data["out"]
num = float

# Awal siklus = motor melompat dari luar kanan ke tepi kiri. Ambang < 0
# (bukan < -40): sampel pasca-lompatan bisa terlanjur ±0,1 dtk setelah restart
# (motor easeOut sudah di -22), dan m<0 hanya terjadi di ±0,14 dtk awal siklus.
starts = [
    rows[i]["t"]
    for i in range(1, len(rows))
    if rows[i - 1]["m"] > strip_w * 0.8 and rows[i]["m"] < 0
]
if not starts:
    sys.exit("awal siklus tidak terdeteksi")
cycle = statistics.median([b - a for a, b in zip(starts, starts[1:])]) if len(starts) > 1 else 6.0
for r in rows:
    base = max([s for s in starts if s <= r["t"]], default=starts[0] - cycle)
    r["ph"] = round((r["t"] - base) % cycle, 2)

checks = []


def check(name, ok, detail):
    checks.append(ok)
    print(f"[{'LULUS' if ok else 'GAGAL'}] {name} — {detail}")


# ---- Gaya statis mengikuti konfigurasi kustom ----
check("ukuran huruf 12px", styles["fontSize"] == "12px", styles["fontSize"])
check("font mono", bool(re.search(r"mono|menlo", styles["fontFamily"], re.I)), styles["fontFamily"][:70])
check("KAPITAL nonaktif (transform none)", styles["transform"] == "none", styles["transform"])
check("miring (italic)", styles["style"] == "italic", styles["style"])
check("ketebalan bold (700)", styles["weight"] == "700", styles["weight"])
check("BOOM tidak dirender", styles["boomAda"] is False, f"chip ada={styles['boomAda']}")
# ---- Gaya animasi 3D (kin-test2 = flip3d): kapsul berputar 3D dgn perspektif,
#      TANPA wipe clip-path ----
check("kapsul berputar 3D (matrix3d dgn perspektif)",
      "matrix3d" in styles.get("pillTransform", ""), styles.get("pillTransform", "")[:80])
check("tanpa wipe clip-path (gaya 3D, bukan klasik)", styles.get("pillClip") == "none",
      styles.get("pillClip", ""))
words = styles["words"]
check("4 kata sesuai teks admin", [w["t"] for w in words] == ["Promo", "Spesial", "Hari", "Ini"],
      f"{[w['t'] for w in words]}")
# Tailwind 4 menyajikan warna sebagai oklch — violet-600 & red-600
VIOLET, RED = "oklch(0.541 0.281 293.009)", "oklch(0.577 0.245 27.325)"
check("warna kata biasa violet", all(w["c"] == VIOLET for w in words[:-1]),
      [w["c"] for w in words])
check("kata terakhir aksen merah (beda dari kata biasa)",
      words[-1]["c"] == RED and len({w["c"] for w in words}) == 2, words[-1]["c"])

# ---- Garis waktu mengikuti siklus 6 dtk ----
check("siklus terukur ≈ 6 dtk", abs(cycle - 6) <= 0.3, f"siklus={cycle:.2f} dtk (jumps={len(starts)})")
park_x = data.get("clientW", strip_w - 2) - 60
park = [r["m"] for r in rows if 0.3 * cycle <= r["ph"] <= 0.55 * cycle]
check("motor berhenti di posisi parkir", bool(park) and all(abs(x - park_x) <= 1.5 for x in park),
      f"x={min(park):.1f}..{max(park):.1f} target {park_x:.1f}" if park else "tidak ada sampel")
gone = [r["m"] for r in rows if r["ph"] >= 0.9 * cycle]
check("motor keluar layar di ujung siklus", bool(gone) and all(x >= strip_w + 10 for x in gone), f"x={gone[:3]}")
boom_v = [num(r["b"][0]) for r in rows]
check("tanpa BOOM: chip sentinel 0 sepanjang siklus", all(v <= 0.02 for v in boom_v), f"maks={max(boom_v):.2f}")
early = [num(r["w"][k][0]) for r in rows if r["ph"] <= 0.14 * cycle for k in range(4)]
late = [num(r["w"][k][0]) for r in rows if r["ph"] >= 0.8 * cycle for k in range(4)]
hold = [num(r["w"][k][0]) for r in rows if 0.5 * cycle <= r["ph"] <= 0.58 * cycle for k in range(4)]
check("kata transparan di awal siklus", all(v <= 0.02 for v in early), f"maks={max(early):.2f}")
check("kata terlihat penuh di fase tahan", all(v >= 0.98 for v in hold), f"min={min(hold):.2f}")
check("kata transparan lagi di akhir siklus", all(v <= 0.02 for v in late), f"maks={max(late):.2f}")

print(f"\nHASIL: {sum(checks)}/{len(checks)} pemeriksaan lulus")
sys.exit(0 if all(checks) else 1)

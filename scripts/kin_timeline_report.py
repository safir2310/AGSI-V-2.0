"""Analisis cuplikan garis waktu adegan kurir (hasil scripts/kin_timeline.js).

Pakai: python scripts/kin_timeline_report.py <timeline.raw>
Mencetak tabel per fase siklus (fase dalam DETIK, 0–8) + hasil pemeriksaan
(LULUS/GAGAL). Kode keluar 0 hanya bila semua pemeriksaan lulus.
"""
import json
import re
import sys
from pathlib import Path

CYCLE = 8.0
raw = Path(sys.argv[1]).read_text().strip()
data = json.loads(raw)
if isinstance(data, str):
    data = json.loads(data)
if "error" in data:
    sys.exit(f"ERROR dari halaman: {data['error']}")
strip_w = data["stripW"]
rows = data["out"]

# Skema cuplikan: kata/kapsul/boom = [opacity(str), x, y, scaleX, filter, letterSpacing, clipPath]
num = float  # opacity & letterSpacing datang sebagai string dari getComputedStyle
INS = re.compile(r"inset\(([-\d.]+)% ([-\d.]+)% ([-\d.]+)% ([-\d.]+)%\)")


def insets(cp):
    m = INS.match(cp)
    return [float(v) for v in m.groups()] if m else None


def overlap(a, b):
    """Luas irisan dua kotak [kiri, atas, kanan, bawah] (px²)."""
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


# Awal siklus = saat motor melompat dari luar kanan ke luar kiri
starts = [
    rows[i]["t"]
    for i in range(1, len(rows))
    if rows[i - 1]["m"] > strip_w * 0.8 and rows[i]["m"] < -40
]
if not starts:
    sys.exit("awal siklus tidak terdeteksi")
if any(len(r["w"]) != 4 for r in rows):
    sys.exit("kata spanduk tidak terdeteksi (harusnya 4 span.inline-block pada kapsul) — cek urutan anak flag wrapper")
for r in rows:
    base = max([s for s in starts if s <= r["t"]], default=starts[0] - CYCLE)
    r["ph"] = round((r["t"] - base) % CYCLE, 2)


def at(ph):
    return min(rows, key=lambda r: abs(r["ph"] - ph))


print(
    f"viewport {data.get('vw')}px, strip {strip_w}x{data.get('stripH')}px, {len(rows)} cuplikan, "
    f"awal siklus terdeteksi pada t={starts}"
)
print("fase |  motor x | kapsul op | clip-path                      | kata op      | tracking[0] | blur[0]    | boom | garis | spanduk kiri/kanan/lebar")
for ph in [0.0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.6, 5.0, 5.4, 5.8, 6.2, 6.6, 7.0, 7.6]:
    r = at(ph)
    print(
        f"{r['ph']:4.2f} | {r['m']:8.1f} | {num(r['p'][0]):9.2f} | {r['p'][6]:30} | "
        f"{' '.join(f'{num(w[0]):.2f}' for w in r['w'])} | {r['w'][0][5]:>11} | {r['w'][0][4]:>10} | "
        f"{num(r['b'][0]):.2f} | {r['l']:.2f} | {r['fit'][0]:.0f}/{r['fit'][1]:.0f}/{r['fit'][2]:.0f}"
    )

park_x = data.get("clientW", strip_w - 2) - 60
checks = []


def check(name, ok, detail):
    checks.append(ok)
    print(f"[{'LULUS' if ok else 'GAGAL'}] {name} — {detail}")


def words_in(lo, hi):
    return [num(r["w"][k][0]) for r in rows if lo <= r["ph"] <= hi for k in range(4)]


# ---- Motor ----
m_hold = [r["m"] for r in rows if 1.5 <= r["ph"] <= 4.9]
check("motor berhenti di posisi parkir (strip-60) selama fase teks", all(abs(x - park_x) <= 1.5 for x in m_hold),
      f"x={min(m_hold):.1f}..{max(m_hold):.1f}, target {park_x:.1f}")
m_in = [r["m"] for r in rows if r["ph"] <= 0.05]
m_out = [r["m"] for r in rows if r["ph"] >= 7.9]
check("motor mulai masuk dari luar tepi kiri (tidak muncul tiba-tiba di tengah)", all(x < -20 for x in m_in), f"x={m_in}")
check("motor berakhir di luar layar kanan", all(x >= strip_w + 10 for x in m_out), f"x={m_out}")
gone = [r["k"] for r in rows if r["ph"] >= 6.9]
check("tidak ada bagian motor/tali/asap yang tertinggal di tepi kanan setelah motor pergi",
      all(v >= strip_w - 0.5 for v in gone), f"titik terkiri={min(gone):.1f}px, tepi kanan strip={strip_w:.0f}px")

# ---- Kata: fade in / tahan / fade out ----
early = words_in(0.0, 1.25)
shown = words_in(3.7, 5.1)
late = words_in(6.3, 8.0)
mid = words_in(5.3, 6.2)
check("fade in: semua kata transparan sebelum reveal", all(v <= 0.02 for v in early), f"maks opacity={max(early):.2f}")
check("tahan: semua kata terlihat penuh di fase baca", all(v >= 0.98 for v in shown), f"min opacity={min(shown):.2f}")
check("fade out: semua kata transparan setelah pergi", all(v <= 0.02 for v in late), f"maks opacity={max(late):.2f}")
check("fade out berjenjang (ada nilai antara 0 dan 1)", any(0.1 < v < 0.9 for v in mid),
      f"contoh nilai tengah: {sorted({round(v, 2) for v in mid})[:6]}")

# ---- Pop-up ----
ijo_peak = max(r["w"][3][3] for r in rows)
ijo_hold = [r["w"][3][3] for r in rows if 3.7 <= r["ph"] <= 5.1]
others_peak = max(r["w"][k][3] for r in rows for k in range(3))
check("pop-up: 'Ijo' membesar lebih dari 1.3 sebelum mengecil pas", ijo_peak > 1.3, f"puncak scale={ijo_peak:.2f}")
check("pop-up: kata lain juga mem-pop (lebih dari 1.1)", others_peak > 1.1, f"puncak scale={others_peak:.2f}")
check("pop-up: 'Ijo' berakhir pas di scale 1 saat tahan", all(abs(s - 1) < 0.02 for s in ijo_hold),
      f"scale saat tahan={sorted({round(s, 2) for s in ijo_hold})}")

# Kata muncul berurutan kiri → kanan
first_on = []
for k in range(4):
    first_on.append(next((r["ph"] for r in rows if r["ph"] < 4 and num(r["w"][k][0]) > 0.05), None))
check("kata muncul berurutan kiri → kanan", all(first_on[k] < first_on[k + 1] for k in range(3)),
      f"mulai tampak (dtk): {first_on}")

# ---- Tracking ----
ls_entry = [r["w"][k][5] for r in rows if r["ph"] <= 1.25 for k in range(4)]
ls_hold = {r["w"][k][5] for r in rows if 3.7 <= r["ph"] <= 5.1 for k in range(4)}
ls_exit = [r["w"][k][5] for r in rows if r["ph"] >= 6.3 for k in range(4)]
check("tracking: huruf rapat (negatif) saat mulai masuk", all(v.startswith("-") for v in ls_entry), f"{sorted(set(ls_entry))}")
check(
    "tracking: normal saat tahan",
    all(v == "normal" or float(v[:-2]) < 0.5 for v in ls_hold),
    f"{sorted(ls_hold)}",
)
check("tracking: melebar saat memudar", all(float(v[:-2]) > 2 for v in ls_exit), f"{sorted(set(ls_exit))}")

# ---- Motion blur ----
bl_entry = [r["w"][k][4] for r in rows if r["ph"] <= 1.25 for k in range(4)]
bl_hold = {r["w"][k][4] for r in rows if 3.7 <= r["ph"] <= 5.1 for k in range(4)}
bl_exit = [r["w"][k][4] for r in rows if r["ph"] >= 6.3 for k in range(4)]
bl_mid = [r["w"][k][4] for r in rows if 5.3 <= r["ph"] <= 6.2 for k in range(4)]
check("motion blur: buram saat mulai masuk", all("blur(8px)" in v for v in bl_entry), f"{sorted(set(bl_entry))}")
check("motion blur: tajam saat tahan", all(v in ("none", "blur(0px)") for v in bl_hold), f"{sorted(bl_hold)}")
check("motion blur: buram saat pergi", all("blur(10px)" in v for v in bl_exit), f"{sorted(set(bl_exit))}")
check("motion blur: nilai antara saat transisi keluar", any(v not in ("none", "blur(0px)", "blur(10px)") for v in bl_mid),
      f"contoh: {sorted(set(bl_mid))[:5]}")

# ---- Slide-in ----
sx = [r["w"][k][1] for r in rows if r["ph"] <= 1.25 for k in range(4)]
sx_hold = {r["w"][k][1] for r in rows if 3.7 <= r["ph"] <= 5.1 for k in range(4)}
sx_exit = [r["w"][k][1] for r in rows if r["ph"] >= 6.3 for k in range(4)]
check("slide-in: kata berawal digeser ke kiri (x negatif)", all(v < -20 for v in sx), f"x={sorted(set(sx))}")
check("slide-in: kata berakhir di posisi pas (x=0) saat tahan", all(abs(v) < 0.6 for v in sx_hold), f"x={sorted(sx_hold)}")
check("slide-out: kata meluncur ke kanan saat motor pergi", all(v > 20 for v in sx_exit), f"x={sorted(set(sx_exit))}")

# ---- Text reveal (clip-path kapsul) ----
clip_early = {r["p"][6] for r in rows if r["ph"] <= 1.2}
clip_hold = {r["p"][6] for r in rows if 3.7 <= r["ph"] <= 5.1}
clip_late = {r["p"][6] for r in rows if r["ph"] >= 6.4}
clip_mid = [r["p"][6] for r in rows if 1.35 <= r["ph"] <= 2.9]
check("text reveal: kapsul tertutup penuh sebelum reveal", all(v == "inset(-40% 100% -40% 0%)" for v in clip_early), f"{clip_early}")
check("text reveal: kapsul terbuka penuh saat tahan", all(v == "inset(-40% -12% -40% 0%)" for v in clip_hold), f"{clip_hold}")
check("text reveal: kapsul menutup lagi saat pergi", all(v == "inset(-40% -12% -40% 110%)" for v in clip_late), f"{clip_late}")
check("text reveal: terbuka bertahap (wipe dari kiri ke kanan)", len(set(clip_mid)) >= 8,
      f"{len(set(clip_mid))} nilai clip-path berbeda selama 1,35–2,9 dtk")

# Wipe ter-sync dengan pop-up kata: kata yang sudah tampak penuh (opacity ≥ 0,95)
# harus seluruhnya berada di dalam daerah kapsul yang sudah terbuka
bad = []
for r in rows:
    if not (1.3 <= r["ph"] <= 3.2) or not INS.match(r["p"][6]):
        continue
    ins = insets(r["p"][6])
    pw = r["pb"][2] - r["pb"][0]
    x0 = r["pb"][0] + pw * ins[3] / 100
    x1 = r["pb"][2] - pw * ins[1] / 100
    for k in range(4):
        if num(r["w"][k][0]) >= 0.95 and (r["wb"][k][0] < x0 - 1.5 or r["wb"][k][2] > x1 + 1.5):
            bad.append((r["ph"], k, round(r["wb"][k][2] - x1, 1)))
check("text reveal ter-sync: kata yang sudah tampak penuh tidak terpotong tepi wipe", not bad,
      f"pelanggaran (fase, kata, px): {bad[:4]}" if bad else "tidak ada kata terpotong")

# ---- BOOM: delay 3,5 dtk, memantul masuk ±0,2 dtk, penuh ±3,75–4,3 dtk, memudar s.d. 4,9 dtk ----
boom_on = [num(r["b"][0]) for r in rows if 3.8 <= r["ph"] <= 4.25]
boom_off = [num(r["b"][0]) for r in rows if 0.3 <= r["ph"] <= 3.2]
boom_gone = [num(r["b"][0]) for r in rows if 5.0 <= r["ph"] <= 5.5]
boom_peak = max(r["b"][3] for r in rows)
check("BOOM terlihat penuh di 3,8–4,25 dtk", all(v >= 0.98 for v in boom_on), f"min opacity={min(boom_on):.2f}")
check("BOOM tersembunyi di 0,3–3,2 dtk", all(v <= 0.02 for v in boom_off), f"maks opacity={max(boom_off):.2f}")
check("BOOM sudah hilang di 5,0–5,5 dtk", all(v <= 0.02 for v in boom_gone), f"maks opacity={max(boom_gone):.2f}")
check("BOOM memantul (scale mencapai target 1.15)", boom_peak >= 1.14, f"puncak scale={boom_peak:.2f}")

# Komposisi BOOM terhadap spanduk & tepi strip (kotak chip ikut transform)
vis = [r for r in rows if num(r["b"][0]) > 0.05]
chip_top = min(r["c"][1] for r in vis)
chip_bot = max(r["c"][3] for r in vis)
pill_top = min(r["pb"][1] for r in vis)
ov_word = max((overlap(r["c"], r["wb"][k]) for r in vis for k in range(4) if num(r["w"][k][0]) > 0.05), default=0.0)
ov_pill = max((overlap(r["c"], r["pb"]) for r in vis), default=0.0)
check("BOOM tidak terpotong tepi atas strip", chip_top >= -0.5, f"titik tertinggi chip y={chip_top:.1f}px (tepi atas strip = 0)")
check("BOOM tidak menutupi huruf spanduk", ov_word <= 1.0, f"luas irisan chip–kotak kata maks={ov_word:.1f}px²")
print(f"      info: chip y {chip_top:.1f}–{chip_bot:.1f}px, puncak kapsul spanduk y={pill_top:.1f}px, "
      f"irisan chip–kapsul maks={ov_pill:.1f}px²")

# ---- Garis kecepatan: penuh saat motor masuk, memudar saat melambat, nol saat
# berhenti, muncul lagi saat melesat pergi lalu memudar (fase dalam DETIK) ----
ln_start = [r["l"] for r in rows if r["ph"] <= 0.15]
ln_fade = [r["l"] for r in rows if 0.6 <= r["ph"] <= 0.8]
ln_stop = [r["l"] for r in rows if 1.4 <= r["ph"] <= 5.0]
ln_dep = [r["l"] for r in rows if 5.2 <= r["ph"] <= 5.6]
ln_late = [r["l"] for r in rows if r["ph"] >= 7.0]
check("garis kecepatan tampil saat motor masuk", bool(ln_start) and max(ln_start) >= 0.9 and min(ln_start) > 0.5,
      f"opacity={ln_start}")
check("garis kecepatan memudar saat motor melambat", bool(ln_fade) and max(ln_fade) < min(ln_start) and min(ln_fade) > 0.1,
      f"0,6–0,8 dtk: {ln_fade}")
check("garis kecepatan tersembunyi saat motor berhenti", bool(ln_stop) and all(v <= 0.02 for v in ln_stop),
      f"maks opacity={max(ln_stop):.2f}")
check("garis kecepatan tampil lagi saat motor melesat pergi", bool(ln_dep) and max(ln_dep) >= 0.9,
      f"maks opacity={max(ln_dep) if ln_dep else '-'}")
check("garis kecepatan hilang setelah motor keluar", bool(ln_late) and all(v <= 0.02 for v in ln_late),
      f"maks opacity={max(ln_late):.2f}")

# ---- Spanduk muat di dalam strip saat motor berhenti ----
fit = [r["fit"] for r in rows if 1.3 <= r["ph"] <= 5.0]
check("spanduk tidak terpotong di tepi kiri strip saat motor berhenti", all(f[0] >= 0 for f in fit),
      f"jarak kiri min={min(f[0] for f in fit):.1f}px, lebar maks={max(f[2] for f in fit):.0f}px")

print(f"\nHASIL: {sum(checks)}/{len(checks)} pemeriksaan lulus")
sys.exit(0 if all(checks) else 1)

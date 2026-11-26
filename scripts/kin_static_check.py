"""Periksa dua cuplikan keadaan adegan kurir saat reduced-motion aktif
(hasil scripts/kin_static.js): semua elemen harus statis & tetap terbaca.

Pakai: python scripts/kin_static_check.py "<cuplikan 1>" "<cuplikan 2>"
"""
import json
import sys


def load(s):
    s = s.strip()
    try:
        d = json.loads(s)
    except json.JSONDecodeError:
        d = json.loads(s[s.find("{") : s.rfind("}") + 1])
    return json.loads(d) if isinstance(d, str) else d


a, b = load(sys.argv[1]), load(sys.argv[2])
if "error" in a:
    sys.exit(f"ERROR dari halaman: {a['error']}")
print(f"cuplikan: {json.dumps(a, ensure_ascii=False)}")

park_x = a["stripW"] - 2 - 60  # clientWidth = lebar strip tanpa border
checks = [
    ("4 kata terdeteksi pada kapsul", len(a["words"]) == 4, f"{len(a['words'])} kata"),
    ("motor tampil statis di posisi parkir", abs(a["motor"] - park_x) <= 1.5, f"x={a['motor']} target {park_x:.1f}"),
    ("spanduk terlihat penuh di dalam strip", a["pill"][0] >= 0 and a["pill"][1] >= 0, f"kiri/kanan={a['pill'][:2]}"),
    ("spanduk tidak terpotong (clip-path none)", a["clip"] == "none", a["clip"]),
    ("semua kata terlihat penuh", all(float(v) >= 0.99 for v in a["words"]), a["words"]),
    ("ledakan BOOM disembunyikan", float(a["chip"]) <= 0.01, f"opacity={a['chip']}"),
    ("garis kecepatan disembunyikan", float(a["lines"]) <= 0.01, f"opacity={a['lines']}"),
    ("keadaan identik setelah 1,5 dtk (tidak ada gerakan)", a == b, "sama" if a == b else f"beda: {json.dumps(b, ensure_ascii=False)}"),
]
ok = True
for name, passed, detail in checks:
    ok &= passed
    print(f"[{'LULUS' if passed else 'GAGAL'}] {name} — {detail}")
print(f"animasi berjalan di halaman: {a['running']}")
print(f"HASIL: {sum(c[1] for c in checks)}/{len(checks)} pemeriksaan lulus")
sys.exit(0 if ok else 1)

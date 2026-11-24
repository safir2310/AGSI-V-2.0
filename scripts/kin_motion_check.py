"""Pemeriksaan DOM AGSI Motion Studio dari rute /kin-motion.

Argumen: '<json sampel awal (~0,3 dtk)>' '<json sampel mapan (~2,5 dtk)>'
Harapkan: kata hero ter-split dgn entrance berjalan (opacity <1 / transform
ada), kartu produk beranimasi flip3d (matrix3d), lalu semua mapan (opacity 1).
"""
import json
import sys

def load(raw: str) -> dict:
    raw = raw.strip()
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        d = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
    if isinstance(d, str):
        d = json.loads(d)
    return d

early = load(sys.argv[1])
settled = load(sys.argv[2])

checks = []


def check(name, ok, detail):
    checks.append(ok)
    print(f"[{'LULUS' if ok else 'GAGAL'}] {name} — {detail}")


print(f"awal : {early}")
print(f"mapan: {settled}")

check("teks hero ter-split per kata (MotionText pop)", early.get("heroWords", 0) >= 1, f"{early.get('heroWords')} kata")
check("entrance hero berjalan (opacity <1 saat awal)", 0 <= early.get("heroOp", 1) < 0.95, f"opacity={early.get('heroOp')}")
check("hero memakai transform (pop via spring)", early.get("heroTf", "none") != "none", early.get("heroTf", "")[:40])
check("kartu produk dirender (injeksi demo)", early.get("cards", 0) >= 2, f"{early.get('cards')} kartu")
check("kartu flip3d berputar (matrix3d)", "matrix3d" in early.get("cardTf", ""), early.get("cardTf", "")[:40])
check("hero mapan penuh (opacity 1)", settled.get("heroOp") == 1.0, f"opacity={settled.get('heroOp')}")
# framer mempertahankan transformPerspective di transform → kartu mapan
# memang tetap matrix3d, tapi komponen rotasinya harus kembali identitas
# (m11=1, m12=0, m21=0, m22=1 = rotateX 0)
settled_tf = settled.get("cardTf", "")
check("kartu mapan selesai (rotasi kembali identitas)",
      settled_tf.startswith("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,") or settled_tf == "none",
      settled_tf[:48])

print(f"\nHASIL: {sum(checks)}/{len(checks)} pemeriksaan lulus")
sys.exit(0 if all(checks) else 1)

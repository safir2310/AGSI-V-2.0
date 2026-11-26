"""Periksa popup banner beranda dari rute kin-popup: HARUS lebih kecil
(kartu ≤ 82% lebar viewport — dulu 88vw/21rem) dan TANPA teks "PROMO".

Pakai: python scripts/kin_popup_check.py '<json hasil eval>' <viewport>
"""
import json
import sys

raw = sys.argv[1].strip()
vw = float(sys.argv[2])
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    d = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
if isinstance(d, str):
    d = json.loads(d)
if "error" in d:
    sys.exit(f"ERROR dari halaman: {d['error']}")

print(f"popup: lebar={d['w']}px tinggi={d['h']}px | chip PROMO ada: {d['promo']} | viewport={vw}")

checks = []


def check(name, ok, detail):
    checks.append(ok)
    print(f"[{'LULUS' if ok else 'GAGAL'}] {name} — {detail}")


check("tanpa chip teks PROMO", d["promo"] == 0, f"jumlah={d['promo']}")
check("popup lebih kecil (≤82% viewport)", d["w"] <= vw * 0.82, f"{d['w']:.0f}/{vw:.0f} = {d['w'] / vw * 100:.1f}%")
check("masih layak dibaca (≥230px)", d["w"] >= 230, f"{d['w']:.0f}px")

print(f"\nHASIL: {sum(checks)}/{len(checks)} pemeriksaan lulus")
sys.exit(0 if all(checks) else 1)

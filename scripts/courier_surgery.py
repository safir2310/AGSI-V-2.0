"""Bedah HomeView.tsx: buang blok adegan kurir yang kini pindah ke
CourierScene.tsx (konstanta CONFETTI/RIDE/kata, hook pengukur lebar strip,
dan <section> adegan), lalu pasang <CourierScene cfg={courierAnim} /> yang
konfigurasinya datang dari store settings (Profil Admin → Animasi Beranda).
Setiap marker WAJIB ditemukan tepat satu kali — bila tidak, batal tanpa tulis.
"""
from pathlib import Path

P = Path("/home/z/my-project/src/components/customer/HomeView.tsx")
src = P.read_text()
orig = src


def cut(src: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    i = src.find(start_marker)
    j = src.find(end_marker, i + len(start_marker) if i >= 0 else 0)
    if i < 0 or j < 0 or src.find(start_marker, i + 1) >= 0:
        raise SystemExit(f"marker {label!r} tidak unik/tidak ketemu: i={i} j={j}")
    return src[:i] + replacement + src[j + len(end_marker):]


# 1) Konstanta CONFETTI … WIPE_END pindah ke CourierScene.tsx
src = cut(
    src,
    '/** Konfeti animasi "BOOM!" ulang tahun',
    "const WIPE_END = wordIn(BANNER_WORDS.length - 1) + WORD_POP * 0.5;\n\n",
    "",
    "konstanta adegan",
)

# 2) Hook pengukur lebar strip + lintasan motor pindah ke CourierScene.tsx
src = cut(
    src,
    "  /** Lebar strip jalan (px) — diukur sekali",
    "  const rideX = [-90, parkX, parkX, roadW + 20];\n",
    "",
    "hook roadRef/rideX",
)

# 3) <section> adegan → <CourierScene> (baca store di HomeView)
new_section = (
    "      {/* ===== JALANAN ANIMASI: KURIR + TIPOGRAFI KINETIK =====\n"
    "          Adegannya kini komponen CourierScene (CourierScene.tsx) dengan\n"
    "          konfigurasi yang dikelola admin dari Profil → \"Animasi\n"
    "          Beranda\": teks spanduk, font, gaya huruf, warna, ukuran,\n"
    "          kecepatan siklus, ledakan BOOM, dan saklar aktif (kolom JSON\n"
    "          courierAnim di tabel StoreSetting, ikut snapshot /api/settings).\n"
    "          Nonaktif → adegan tidak dirender sama sekali. */}\n"
    "      {courierAnim.enabled && <CourierScene cfg={courierAnim} />}\n\n"
)
src = cut(src, '      {/* ===== JALANAN ANIMASI:', "      </section>\n", new_section, "section adegan")

# 4) Baca konfigurasi dari store settings (setelah baris promo)
promo_line = '  const promo = useSettingsStore((s) => s.promo);\n'
if src.count(promo_line) != 1:
    raise SystemExit(f"baris promo tidak unik: {src.count(promo_line)}")
src = src.replace(
    promo_line,
    promo_line + "  // Konfigurasi adegan animasi kurir (Profil Admin → Animasi Beranda)\n"
    "  const courierAnim = useSettingsStore((s) => s.courierAnim);\n",
)

# 5) Import CourierScene (tepat sebelum import hooks)
hooks_import = 'import { refreshVouchers, useProductsStore, useSettingsStore, useVouchersStore } from "@/lib/hooks";\n'
if src.count(hooks_import) != 1:
    raise SystemExit(f"import hooks tidak unik: {src.count(hooks_import)}")
src = src.replace(
    hooks_import,
    'import { CourierScene } from "@/components/customer/CourierScene";\n' + hooks_import,
)

if src == orig:
    raise SystemExit("tidak ada perubahan — marker cocok tapi hasil sama?")
P.write_text(src)
print("HomeView.tsx selesai dibedah:", len(orig), "->", len(src), "karakter")

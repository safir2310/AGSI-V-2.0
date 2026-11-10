#!/usr/bin/env python3
"""
Generate ikon launcher & notifikasi aplikasi AGSI (topi koki + api).
Output:
  - mipmap-*/ic_launcher_foreground.png   (layer adaptif, 5 densitas)
  - mipmap-*/ic_launcher.png + round      (legacy, 5 densitas)
  - drawable-*/ic_notification.png        (siluet putih, 5 densitas)
  - app/ic_launcher-playstore.png         (512px utk Play Console)
"""
from PIL import Image, ImageDraw

RES = "/home/z/my-project/download/agsi-android/app/src/main/res"
APP = "/home/z/my-project/download/agsi-android/app"

CREAM = (255, 247, 237, 255)      # #FFF7ED
ORANGE = (249, 115, 22, 255)      # #F97316
ORANGE_DARK = (234, 88, 12, 255)  # #EA580C
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

SS = 4  # supersample factor


def draw_hat(d: ImageDraw.ImageDraw, c: int, scale: float = 1.0,
             hat=ORANGE, band=ORANGE_DARK, flame=CREAM) -> None:
    """Gambar topi koki + api di tengah kanvas ukuran c (dalam resolusi SS)."""
    def u(f):
        return f * c * scale

    cx, cy = c / 2, c / 2
    # Ambin (puff) atas — tiga lingkaran
    for fx, fy, fr in [(-0.13, 0.00, 0.115), (0.0, -0.06, 0.135), (0.13, 0.00, 0.115)]:
        x, y, r = cx + u(fx), cy + u(fy), u(fr)
        d.ellipse([x - r, y - r, x + r, y + r], fill=hat)
    # Badan topi
    d.rounded_rectangle(
        [cx - u(0.155), cy + u(0.02), cx + u(0.155), cy + u(0.26)],
        radius=u(0.03), fill=hat)
    # Pita bawah
    d.rounded_rectangle(
        [cx - u(0.20), cy + u(0.22), cx + u(0.20), cy + u(0.34)],
        radius=u(0.04), fill=band)
    # Api (cutout) — titik + tetesan
    r = u(0.062)
    fyc = cy + u(0.16)
    d.polygon([(cx, cy + u(0.04)), (cx - r, fyc), (cx + r, fyc)], fill=flame)
    d.ellipse([cx - r, fyc - r, cx + r, fyc + r], fill=flame)


def render(size: int, painter) -> Image.Image:
    img = Image.new("RGBA", (size * SS, size * SS), CLEAR)
    painter(ImageDraw.Draw(img), size * SS)
    return img.resize((size, size), Image.LANCZOS)


def fg_painter(d, c):
    draw_hat(d, c, scale=1.0)


def legacy_painter(d, c):
    # Latar krem rounded-square + topi lebih besar
    d.rounded_rectangle([0, 0, c, c], radius=int(c * 0.20), fill=CREAM)
    draw_hat(d, c, scale=1.08)


def round_painter(d, c):
    d.ellipse([0, 0, c, c], fill=CREAM)
    draw_hat(d, c, scale=1.02)


def notif_painter(d, c):
    # Siluet putih dengan api transparan (ikon notifikasi = mask alpha)
    draw_hat(d, c, scale=1.05, hat=WHITE, band=WHITE, flame=CLEAR)


DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

for dens, mult in DENSITIES.items():
    fg_dir = f"{RES}/mipmap-{dens}"
    nd_dir = f"{RES}/drawable-{dens}"
    # Foreground adaptif: canvas 108dp
    fg_size = int(108 * mult)
    render(fg_size, fg_painter).save(f"{fg_dir}/ic_launcher_foreground.png")
    # Legacy launcher: 48dp
    legacy_size = int(48 * mult)
    render(legacy_size, legacy_painter).save(f"{fg_dir}/ic_launcher.png")
    render(legacy_size, round_painter).save(f"{fg_dir}/ic_launcher_round.png")
    # Ikon notifikasi: 24dp
    notif_size = int(24 * mult)
    render(notif_size, notif_painter).save(f"{nd_dir}/ic_notification.png")

# Ikon Play Store 512px
render(512, legacy_painter).save(f"{APP}/ic_launcher-playstore.png")

print("Ikon selesai dibuat.")

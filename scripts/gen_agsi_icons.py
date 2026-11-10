#!/usr/bin/env python3
"""
Generate AGSI launcher icons from the login-page mascot (ChickenLogo).
Replicates src/components/logo/ChickenLogo.tsx as static SVG (gradients inlined,
filters dropped), renders via cairosvg, composes with PIL.

Outputs (into download/agsi-android):
  - mipmap-*/ic_launcher_foreground.png   (adaptive foreground, 108dp canvas)
  - mipmap-*/ic_launcher_bg.png           (adaptive background, orange radial grad)
  - mipmap-*/ic_launcher_monochrome.png   (white silhouette, 108dp canvas)
  - mipmap-*/ic_launcher.png              (legacy, rounded-square)
  - mipmap-*/ic_launcher_round.png        (legacy, circle)
  - drawable-*dpi/ic_notification.png     (white silhouette, 24dp canvas)
  - ic_launcher-playstore.png             (512px full square)
"""
import os
import cairosvg
from PIL import Image, ImageDraw, ImageOps

ROOT = "/home/z/my-project/download/agsi-android/app/src/main/res"
OUT_PLAYSTORE = "/home/z/my-project/download/agsi-android/app/ic_launcher-playstore.png"

# ============================================================ CHICKEN SVG
GRADIENT_DEFS = """
<defs>
  <radialGradient id="gBody" cx="36%" cy="28%" r="90%">
    <stop offset="0%" stop-color="#FFD591"/><stop offset="26%" stop-color="#FDBA74"/>
    <stop offset="62%" stop-color="#F97316"/><stop offset="100%" stop-color="#E0570A"/>
  </radialGradient>
  <radialGradient id="gHead" cx="36%" cy="26%" r="92%">
    <stop offset="0%" stop-color="#FFE6BD"/><stop offset="30%" stop-color="#FDBA74"/>
    <stop offset="68%" stop-color="#F97316"/><stop offset="100%" stop-color="#EA580C"/>
  </radialGradient>
  <linearGradient id="gWing" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#F97316"/><stop offset="100%" stop-color="#C2410C"/>
  </linearGradient>
  <linearGradient id="gBelly" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FFFBF5"/><stop offset="100%" stop-color="#FFEDD5"/>
  </linearGradient>
  <linearGradient id="gHat" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#E7EDF3"/>
  </linearGradient>
  <linearGradient id="gBeak" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FCD34D"/><stop offset="100%" stop-color="#F59E0B"/>
  </linearGradient>
  <linearGradient id="gWattle" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FB7185"/><stop offset="100%" stop-color="#E11D48"/>
  </linearGradient>
  <linearGradient id="gGreen" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#4ADE80"/><stop offset="100%" stop-color="#16A34A"/>
  </linearGradient>
  <linearGradient id="gFoot" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#FBBF24"/><stop offset="100%" stop-color="#D97706"/>
  </linearGradient>
</defs>
"""

# Static replica of the mascot (bbox approx: x 42..158, y 10..180 in 200x200)
CHICKEN = """
<ellipse cx="100" cy="136" rx="50" ry="41" fill="url(#gBody)"/>
<ellipse cx="100" cy="146" rx="30" ry="25" fill="url(#gBelly)"/>
<g fill="url(#gFoot)">
  <path d="M84 166 q-8 0 -8 6 q0 5 8 5 q8 0 8 -6 q0 -5 -8 -5 z" transform="translate(0 4)"/>
  <path d="M116 166 q-8 0 -8 6 q0 5 8 5 q8 0 8 -6 q0 -5 -8 -5 z" transform="translate(0 4)"/>
</g>
<g>
  <ellipse cx="57" cy="134" rx="15" ry="27" fill="url(#gWing)" transform="rotate(14 57 134)"/>
  <ellipse cx="143" cy="134" rx="15" ry="27" fill="url(#gWing)" transform="rotate(-14 143 134)"/>
  <ellipse cx="58" cy="128" rx="6" ry="12" fill="#FB923C" opacity="0.55" transform="rotate(14 58 128)"/>
  <ellipse cx="142" cy="128" rx="6" ry="12" fill="#FB923C" opacity="0.55" transform="rotate(-14 142 128)"/>
</g>
<circle cx="100" cy="80" r="42" fill="url(#gHead)"/>
<ellipse cx="80" cy="56" rx="15" ry="9" fill="#FFFFFF" opacity="0.4" transform="rotate(-24 80 56)"/>
<g transform="rotate(-7 100 44)">
  <ellipse cx="100" cy="52" rx="27" ry="6" fill="#C2410C" opacity="0.20"/>
  <g fill="url(#gHat)">
    <circle cx="80" cy="34" r="13"/>
    <circle cx="101" cy="26" r="16"/>
    <circle cx="121" cy="35" r="12"/>
    <path d="M72 40 q30 -22 58 0 l0 12 q-29 -12 -58 0 z"/>
  </g>
  <rect x="76" y="44" width="49" height="12" rx="6" fill="#FFFFFF"/>
  <rect x="76" y="49" width="49" height="7" rx="3.5" fill="#EDF1F5"/>
</g>
<g>
  <ellipse cx="86" cy="78" rx="7" ry="7.5" fill="#451A03"/>
  <circle cx="83.7" cy="75.5" r="2.4" fill="#FFFFFF"/>
  <circle cx="88" cy="80.5" r="1" fill="#FFFFFF" opacity="0.7"/>
  <ellipse cx="114" cy="78" rx="7" ry="7.5" fill="#451A03"/>
  <circle cx="111.7" cy="75.5" r="2.4" fill="#FFFFFF"/>
  <circle cx="116" cy="80.5" r="1" fill="#FFFFFF" opacity="0.7"/>
</g>
<ellipse cx="76" cy="90" rx="6.5" ry="4.5" fill="#F43F5E" opacity="0.3"/>
<ellipse cx="124" cy="90" rx="6.5" ry="4.5" fill="#F43F5E" opacity="0.3"/>
<g>
  <path d="M91 86 L109 86 L100 95 Z" fill="url(#gBeak)"/>
  <path d="M95 94 L105 94 L100 100 Z" fill="#D97706"/>
  <path d="M91 86 L109 86 L100 95 Z" fill="none" stroke="#B45309" stroke-width="0.7" opacity="0.5"/>
</g>
<path d="M100 100 q5 3 4 8 q-1 5 -4 5 q-3 0 -4 -5 q-1 -5 4 -8 z" fill="url(#gWattle)"/>
<g>
  <path d="M66 116 Q100 136 134 116 L134 126 Q100 148 66 126 Z" fill="url(#gGreen)"/>
  <path d="M66 116 Q100 136 134 116 L134 120 Q100 141 66 120 Z" fill="#22C55E" opacity="0.85"/>
  <path d="M126 128 l14 10 l-10 1 l-2 9 z" fill="#16A34A"/>
</g>
<ellipse cx="70" cy="118" rx="8" ry="5" fill="#FFD591" opacity="0.6" transform="rotate(-28 70 118)"/>
"""

# Content bbox in the 200x200 mascot coordinate space
CX_MIN, CX_MAX, CY_MIN, CY_MAX = 42.0, 158.0, 10.0, 180.0
CW, CH = CX_MAX - CX_MIN, CY_MAX - CY_MIN  # 116 x 170


def chicken_group(canvas: int, frac_h: float, center_y_frac: float = 0.5) -> str:
    """Wrap mascot so its height = frac_h*canvas, centered at center_y_frac."""
    scale = (canvas * frac_h) / CH
    tx = canvas / 2 - (CX_MIN + CW / 2) * scale
    ty = canvas * center_y_frac - (CY_MIN + CH / 2) * scale
    return f'<g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.5f})">{CHICKEN}</g>'


def render(width: int, height: int, body: str, out: str) -> Image.Image:
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
           f'height="{height}" viewBox="0 0 {width} {height}">{GRADIENT_DEFS}{body}</svg>')
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=width, output_height=height)
    import io
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    img.save(out)
    return img


def radial_bg_svg(size: int) -> str:
    """Orange radial gradient background (ChickenBadge style) as SVG body."""
    r = size * 0.72
    cx, cy = size * 0.40, size * 0.32
    return (f'<defs><radialGradient id="bg" gradientUnits="userSpaceOnUse" '
            f'cx="{cx}" cy="{cy}" r="{r}">'
            f'<stop offset="0%" stop-color="#FFA757"/><stop offset="45%" stop-color="#F97316"/>'
            f'<stop offset="100%" stop-color="#D9480F"/></radialGradient></defs>'
            f'<rect width="{size}" height="{size}" fill="url(#bg)"/>')


def rounded_mask(size: int, radius_frac: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    rad = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=rad, fill=255)
    return m


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def white_silhouette(chicken_only: Image.Image) -> Image.Image:
    """Solid white shape keeping the alpha channel."""
    a = chicken_only.split()[3]
    solid = Image.new("RGBA", chicken_only.size, (255, 255, 255, 0))
    white = Image.new("RGBA", chicken_only.size, (255, 255, 255, 255))
    solid.paste(white, mask=a)
    return solid


DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def main():
    os.makedirs(os.path.dirname(OUT_PLAYSTORE), exist_ok=True)

    for dpi, mult in DENS.items():
        mm = os.path.join(ROOT, f"mipmap-{dpi}")
        dr = os.path.join(ROOT, f"drawable-{dpi}")
        os.makedirs(mm, exist_ok=True)
        os.makedirs(dr, exist_ok=True)

        # ---- adaptive layers (108dp canvas)
        canvas = int(108 * mult)
        # foreground: chicken ~62% of canvas height, slightly above center
        render(canvas, canvas, chicken_group(canvas, 0.62, 0.47),
               os.path.join(mm, "ic_launcher_foreground.png"))
        # background: orange radial gradient
        render(canvas, canvas, radial_bg_svg(canvas),
               os.path.join(mm, "ic_launcher_bg.png"))
        # monochrome: white silhouette (slightly smaller)
        fg = render(canvas, canvas, chicken_group(canvas, 0.56, 0.47), "/tmp/_mono_src.png")
        white_silhouette(fg).save(os.path.join(mm, "ic_launcher_monochrome.png"))

        # ---- legacy launcher (48dp): gradient bg + chicken, rounded / circle
        size = int(48 * mult)
        bg = Image.new("RGBA", (size, size))
        bgimg = render(size, size, radial_bg_svg(size), "/tmp/_bg.png")
        chick = render(size, size, chicken_group(size, 0.74, 0.50), "/tmp/_ch.png")
        bg.alpha_composite(bgimg)
        bg.alpha_composite(chick)
        sq = bg.copy(); sq.putalpha(rounded_mask(size, 0.18))
        sq.save(os.path.join(mm, "ic_launcher.png"))
        rd = bg.copy(); rd.putalpha(circle_mask(size))
        rd.save(os.path.join(mm, "ic_launcher_round.png"))

        # ---- notification icon (24dp): white silhouette
        nsize = int(24 * mult)
        ns = render(nsize, nsize, chicken_group(nsize, 0.80, 0.50), "/tmp/_notif.png")
        white_silhouette(ns).save(os.path.join(dr, "ic_notification.png"))

    # ---- Play Store icon 512px
    ps = Image.new("RGBA", (512, 512))
    ps.alpha_composite(render(512, 512, radial_bg_svg(512), "/tmp/_ps_bg.png"))
    ps.alpha_composite(render(512, 512, chicken_group(512, 0.76, 0.50), "/tmp/_ps_ch.png"))
    ps.convert("RGB").save(OUT_PLAYSTORE, "PNG")

    print("DONE — icons generated")
    for dpi in DENS:
        mm = os.path.join(ROOT, f"mipmap-{dpi}")
        files = sorted(os.listdir(mm))
        print(dpi, "->", files)


if __name__ == "__main__":
    main()

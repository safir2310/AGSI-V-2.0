"""Generate gambar banner promo untuk testing popup banner AGSI."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 675  # rasio 16:9
img = Image.new("RGB", (W, H), "#F97316")
d = ImageDraw.Draw(img)

# gradasi latar
for y in range(H):
    t = y / H
    r = int(249 + (234 - 249) * t)
    g = int(115 + (88 - 115) * t)
    b = int(22 + (12 - 22) * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))

# lingkaran dekoratif
d.ellipse([W-320, -140, W+140, 320], outline=(255, 255, 255, 60), width=14)
d.ellipse([-180, H-260, 220, H+140], outline=(255, 255, 255), width=12)

def font(sz, bold=True):
    for p in (
        "/usr/share/fonts/truetype/chinese/NotoSansSC-Bold.ttf" if bold else "/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()

# badge
d.rounded_rectangle([70, 90, 470, 158], radius=34, fill="#FFFFFF")
d.text((100, 104), "PROMO SPESIAL", font=font(36), fill="#EA580C")

# judul besar
d.text((70, 200), "DISKON 20%", font=font(120), fill="#FFFFFF")
d.text((70, 350), "Semua Menu Geprek", font=font(56), fill="#FFEDD5")
d.text((70, 430), "Setiap Jumat & Sabtu", font=font(56), fill="#FFEDD5")

# strip bawah
d.rounded_rectangle([70, 540, 660, 610], radius=35, fill="#16A34A")
d.text((100, 552), "Cuma di AGSI — Ayam Geprek Sambal Ijo", font=font(34), fill="#FFFFFF")

img.save("/home/z/my-project/download/test-banner-promo.jpg", "JPEG", quality=88)
print("saved", img.size)

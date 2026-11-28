"""e2e-requests.py — uji end-to-end API Banner & Promo:
login admin → kirim 5 PUT paralel PERSIS seperti sheet → GET round-trip
publik → smoke halaman /profile dgn cookie sesi. Exit 0 = semua lolos."""
import concurrent.futures
import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3123"
# JPEG 1x1 valid (±125 B) — cukup utk pengujian persistensi
IMG = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQN"
    "DAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgAC"
    "EQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQEC"
    "AwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZH"
    "SElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4"
    "ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/oooooA"
    "//9k="
)


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


st, body = call("POST", "/api/auth/login", {"email": "e2e-admin@test.local", "password": "Test1234!"})
assert st == 200, ("login gagal", st, body)
token = body["token"]
print("login OK | role:", body["user"]["role"])

steps = {
    "banner popup": {
        "bannerEnabled": True,
        "bannerTitle": "Promo Kopi E2E",
        "bannerText": "Diskon 20%",
        "bannerTouch": True,
        "bannerImageData": IMG,
    },
    "strip promo": {
        "promoStripEnabled": True,
        "promoStripBadge": "E2E",
        "promoStripTitle": "Promo Hari Ini E2E",
        "promoStripText": "Berlaku hari ini",
    },
    "hero Menu": {
        "menuHeroEnabled": True,
        "menuHeroBadge": "Baru",
        "menuHeroTitle": "Hero E2E",
        "menuHeroText": "Coba sekarang",
        "menuHeroTouch": True,
        "menuHeroImageData": IMG,
    },
    "banner promo Menu": {
        "menuPromoVouchersEnabled": True,
        "menuPromoVouchersMax": 3,
        "menuPromoBanners": [
            {"slot": 1, "enabled": True, "badge": "P1", "title": "Banner Satu", "text": "Teks satu", "emoji": "🥤", "theme": "violet", "imageData": IMG},
            {"slot": 2, "enabled": True, "badge": "P2", "title": "Banner Dua", "text": "Teks dua", "emoji": "🌶️", "theme": "emerald", "imageData": IMG},
        ],
    },
    "slide video promo": {
        "videoPromoEnabled": True,
        "videoPromoSlides": [
            {"slot": 1, "enabled": True, "title": "Video Satu", "linkType": "none", "productId": None},
            {"slot": 2, "enabled": False, "title": "Video Dua", "linkType": "promo", "productId": None},
            {"slot": 3, "enabled": True, "title": "Video Tiga", "linkType": "none", "productId": None},
        ],
    },
}

# Kirim PARALEL — persis perilaku sheet (Promise.allSettled)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
    futs = {ex.submit(call, "PUT", "/api/settings", b, token): k for k, b in steps.items()}
    for f, k in futs.items():
        st, b = f.result()
        print(f"PUT [{k}] -> {st}", "" if st == 200 else json.dumps(b, ensure_ascii=False)[:160])
        assert st == 200, (k, st, b)

st, s = call("GET", "/api/settings")
assert st == 200, ("GET gagal", st)
missing = [k for k in ("banner", "promo", "menuHero", "menuPromo", "videoPromo") if k not in s]
if missing:
    print("GET KEYS:", sorted(s.keys()), "| hilang:", missing)
checks = [
    ("banner.title", s.get("banner", {}).get("bannerTitle") == "Promo Kopi E2E"),
    ("banner.hasImage", s.get("banner", {}).get("bannerHasImage") is True),
    ("strip.title", s.get("promo", {}).get("promoStripTitle") == "Promo Hari Ini E2E"),
    ("hero.title", s.get("menuHero", {}).get("menuHeroTitle") == "Hero E2E"),
    ("hero.hasImage", s.get("menuHero", {}).get("menuHeroHasImage") is True),
    ("menuPromo.banner1.title", s.get("menuPromo", {}).get("banners", [{}])[0].get("title") == "Banner Satu"),
    ("menuPromo.banner1.hasImage", s.get("menuPromo", {}).get("banners", [{}])[0].get("hasImage") is True),
    ("voucher.enabled", s.get("menuPromo", {}).get("menuPromoVouchersEnabled") is True),
    ("video.enabled", s.get("videoPromo", {}).get("enabled") is True),
    ("video.slide1.title", s.get("videoPromo", {}).get("slides", [{}])[0].get("title") == "Video Satu"),
    ("video.slide2.enabled", s.get("videoPromo", {}).get("slides", [{}])[1].get("enabled") is False),
]
for name, okk in checks:
    print(f"GET check {name}: {'OK' if okk else 'FAIL'}")
assert all(okk for _, okk in checks), "ada GET check gagal"

# Smoke halaman SPA (cookie sesi) — seluruh aplikasi + Profil admin hidup di "/"
req = urllib.request.Request(BASE + "/")
req.add_header("Cookie", "agsi_session=" + token)
with urllib.request.urlopen(req, timeout=30) as r:
    html = r.read().decode()
    print("GET / ->", r.status, "| html len:", len(html))
    assert r.status == 200 and len(html) > 1000

print("E2E REQUESTS PASS ✓")

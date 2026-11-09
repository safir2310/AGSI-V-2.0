"""
Setup env DOKU ke Vercel (project agsi-v-2-0) + redeploy produksi.
Token dibaca dari /tmp/vt (TIDAK disimpan di repo). Nilai env dibaca
dari .env lokal sehingga kredensial tidak pernah tertulis di skrip.

Pakai: python3 scripts/vercel-setup-doku-env.py
"""
import json
import pathlib
import time
import urllib.error
import urllib.request

TOKEN = pathlib.Path("/tmp/vt").read_text().strip()
PID = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK"
HDR = {"Authorization": f"Bearer {TOKEN}", "content-type": "application/json"}


def env_value(key: str) -> str:
    """Baca nilai variabel dari .env lokal (buang kutip ganda pembungkus)."""
    for line in pathlib.Path(".env").read_text().splitlines():
        if line.strip().startswith("#") or "=" not in line:
            continue
        k, v = line.strip().split("=", 1)
        if k.strip() == key:
            return v.strip().strip('"')
    raise SystemExit(f"✗ {key} tidak ditemukan di .env")


def api(url, method="GET", body=None):
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers=HDR,
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


# ===== 0. Cek env yang sudah ada =====
existing = {
    e["key"]: e["id"] for e in api(f"https://api.vercel.com/v9/projects/{PID}/env").get("envs", [])
}
dok = [k for k in existing if k.startswith("DOKU_")]
print("0) env Vercel existing:", len(existing), "variabel — DOKU_*:", len(dok))

# ===== 1. Buat env DOKU yang belum ada (yang sudah ada TIDAK disentuh —
#        nilai dari run pertama sudah benar; token ini tak bisa dekripsi
#        untuk verifikasi baca-balik, verifikasi akhir lewat uji produksi) =====
# CATATAN: nilai "DOKU_MERCHANT_ID" dari pemilik ternyata PEM PUBLIC KEY —
# di-set apa adanya (kode qris-config.ts otomatis memindahkannya ke
# DOKU_PUBLIC_KEY) DAN DOKU_PUBLIC_KEY juga di-set eksplisit.
ENV_KEYS = [
    "DOKU_CLIENT_ID",
    "DOKU_CLIENT_SECRET",
    "DOKU_MERCHANT_ID",
    "DOKU_PUBLIC_KEY",
    "DOKU_IS_PRODUCTION",
]
missing = [k for k in ENV_KEYS if k not in existing]
if missing:
    for key in missing:
        body = [{
            "key": key,
            "value": env_value(key),
            "type": "encrypted",
            "target": ["production", "preview"],
        }]
        api(f"https://api.vercel.com/v10/projects/{PID}/env", "POST", body)
        print(f"   + {key} dibuat")
else:
    print("1) semua env DOKU sudah ada — lanjut redeploy")

# ===== 2. Redeploy produksi (build terakhir + env terbaru) =====
print("2) redeploy produksi (name+target)")
new = api(
    "https://api.vercel.com/v13/deployments",
    "POST",
    {"name": "agsi-v-2-0", "target": "production"},
)
uid = new["uid"]
print(f"   deploy baru: {uid} state={new.get('readyState')}")

# ===== 3. Tunggu sampai READY =====
for i in range(60):
    time.sleep(15)
    d = api(f"https://api.vercel.com/v13/deployments/{uid}")
    state = d.get("readyState")
    print(f"   [{(i+1)*15}s] {state}")
    if state == "READY":
        print("3) DEPLOY SIAP:", f"https://{d.get('url')}")
        break
    if state in ("ERROR", "CANCELED"):
        print("3) GAGAL:", state)
        raise SystemExit(1)
else:
    print("3) timeout menunggu deploy")
    raise SystemExit(1)

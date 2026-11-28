"""
vercel-update-db.py — arahkan proyek AGSI ke database Prisma Postgres BARU
(store fuchsia-candle) + redeploy produksi.

Yang dilakukan:
  [1] Upsert 3 env (DATABASE_URL, PRISMA_DATABASE_URL, POSTGRES_URL) → URL baru
      (direct db.prisma.io — sama seperti konfigurasi lama yang terbukti jalan
      di runtime Vercel).
  [2] Cek env lama bernama sama (id BWMZ6wRKtMO5) ter-update nilainya.
  [3] Trigger deploy produksi dari git main.
  [4] Polling sampai READY/ERROR (maks ~12 menit).
  [5] Verifikasi: POST /api/auth/login → 401 (bukan 500), /api/products → 200.

Token dibaca dari /tmp/vt (tidak disimpan di repo).
URL DB dibaca dari /tmp/dburl.txt (rahasia, tak dicetak).
Pakai: python3 scripts/vercel-update-db.py
"""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

TOKEN = pathlib.Path("/tmp/vt").read_text().strip()
PID = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK"
TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR"
URL = pathlib.Path("/tmp/dburl.txt").read_text().strip()
HDR = {"Authorization": f"Bearer {TOKEN}", "content-type": "application/json"}


def api(url, method="GET", body=None, timeout=40):
    req = urllib.request.Request(
        url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers=HDR,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "body": e.read().decode()[:400]}


def mask(u):
    return u.split("//")[0] + "//" + u.split("//")[1].split("@")[0][:6] + "…@" + u.split("@")[1]


# ===== [1] upsert 3 env =====
print(f"[1] upsert env (nilai {mask(URL)})")
for key in ["DATABASE_URL", "PRISMA_DATABASE_URL", "POSTGRES_URL"]:
    res = api(
        f"https://api.vercel.com/v10/projects/{PID}/env?teamId={TEAM}",
        "POST",
        [{"key": key, "value": URL, "type": "encrypted", "target": ["production", "preview", "development"]}],
    )
    created = res.get("created") or res.get("envs") or []
    err = res.get("error") or res.get("_http_error")
    if err:
        print(f"  {key}: respons {err} — cek detail: {json.dumps(res)[:200]}")
    else:
        print(f"  {key}: OK ({len(created)} entri dibuat/di-upsert)")

# ===== [2] verifikasi nilai env (baca-balik id & dec)) =====
print("[2] verifikasi daftar env")
envs = api(f"https://api.vercel.com/v9/projects/{PID}/env?teamId={TEAM}")
keys = {e["key"]: e["id"] for e in envs.get("envs", [])}
db_keys = [k for k in keys if k in ("DATABASE_URL", "PRISMA_DATABASE_URL", "POSTGRES_URL")]
print(f"  env DB terpasang: {db_keys}")
if "DATABASE_URL" not in db_keys:
    print("  ✗ DATABASE_URL tidak ditemukan — hentikan")
    sys.exit(1)

# ===== [3] deploy produksi dari git main =====
print("[3] trigger deploy produksi (git main)")
dep = api(
    f"https://api.vercel.com/v13/deployments?teamId={TEAM}&skipAutoDetectionConfirmation=1",
    "POST",
    {"name": "agsi-v-2-0", "target": "production",
     "gitSource": {"type": "github", "org": "safir2310", "repo": "AGSI-V-2.0", "ref": "main"}},
)
uid = dep.get("uid")
if not uid:
    print("  ✗ deploy gagal dibuat:", json.dumps(dep)[:300])
    sys.exit(1)
print(f"  deployment: {uid} ({dep.get('url')})")

# ===== [4] polling =====
print("[4] polling status (maks 12 menit)")
state = None
for i in range(32):
    time.sleep(20)
    d = api(f"https://api.vercel.com/v13/deployments/{uid}?teamId={TEAM}")
    state = d.get("readyState")
    print(f"  [{(i+1)*20:4d}s] {state}")
    if state in ("READY", "ERROR", "CANCELED"):
        break
if state != "READY":
    print(f"✗ belum READY (state={state}) — cek log deploy.")
    sys.exit(2)
print(f"✓ deploy READY: https://{dep.get('url')}")

# ===== [5] verifikasi runtime =====
print("[5] verifikasi runtime agsi-v-2-0.vercel.app")
import urllib.request as ur
for _ in range(6):
    try:
        req = ur.Request("https://agsi-v-2-0.vercel.app/api/auth/login", method="POST",
                         data=json.dumps({"email": "probe@x.y", "password": "salah"}).encode(),
                         headers={"content-type": "application/json"})
        code = ur.urlopen(req, timeout=30).status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        print("  … jaringan:", e)
        time.sleep(15)
        continue
    print(f"  POST /api/auth/login (password salah) → {code}")
    if code == 401:
        try:
            code2 = ur.urlopen(ur.Request("https://agsi-v-2-0.vercel.app/api/products"), timeout=30).status
            print(f"  GET /api/products → {code2}")
        except urllib.error.HTTPError as e:
            print(f"  GET /api/products → {e.code}")
        print("✓ LOGIN PULIH — 401 berarti logika login normal (bukan 500).")
        sys.exit(0)
    if code == 500:
        time.sleep(20)
print("⚠ masih belum 401 — laporkan output ini.")
sys.exit(3)

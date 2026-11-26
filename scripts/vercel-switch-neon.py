"""
vercel-switch-neon.py — alihkan produksi AGSI dari Prisma Postgres (suspended)
ke Neon (available), lalu redeploy & verifikasi.

Langkah:
  [1] PATCH 3 env (DATABASE_URL id=BWMZ6wRKtMO5Y54H, PRISMA_DATABASE_URL,
      POSTGRES_URL) ke URL Neon pooled.
  [2] Trigger deploy produksi dari git main.
  [3] Polling sampai READY.
  [4] Verifikasi runtime: health database:true, products berisi 14 menu,
      login admin@agsi.test berhasil.

Token: /tmp/vt. URL Neon: /tmp/dburl-neon.txt (pooled). Rahasia tak dicetak.
Pakai: python3 scripts/vercel-switch-neon.py
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
NEON = pathlib.Path("/tmp/dburl-neon.txt").read_text().strip()
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
        return {"_http_error": e.code, "body": e.read().decode()[:300]}


# ===== [1] PATCH env =====
print("[1] PATCH env → Neon")
envs = api(f"https://api.vercel.com/v9/projects/{PID}/env?teamId={TEAM}")
ids = {e["key"]: e["id"] for e in envs.get("envs", [])}
for key in ["DATABASE_URL", "PRISMA_DATABASE_URL", "POSTGRES_URL"]:
    eid = ids.get(key)
    if not eid:
        # belum ada → buat
        r = api(f"https://api.vercel.com/v10/projects/{PID}/env?teamId={TEAM}", "POST",
                [{"key": key, "value": NEON, "type": "encrypted",
                  "target": ["production", "preview", "development"]}])
        ok = r.get("created") or r.get("envs")
        print(f"  {key}: dibuat {'✓' if ok else '✗ ' + json.dumps(r)[:150]}")
    else:
        r = api(f"https://api.vercel.com/v9/projects/{PID}/env/{eid}?teamId={TEAM}", "PATCH",
                {"value": NEON, "target": ["production", "preview", "development"]})
        if "error" in r or "_http_error" in r:
            print(f"  {key}: ✗ {json.dumps(r)[:150]}")
            sys.exit(1)
        print(f"  {key} (id {eid}): ✓ diupdate ke Neon")

# ===== [2] deploy =====
print("[2] trigger deploy produksi")
dep = api(
    f"https://api.vercel.com/v13/deployments?teamId={TEAM}&skipAutoDetectionConfirmation=1",
    "POST",
    {"name": "agsi-v-2-0", "target": "production",
     "gitSource": {"type": "github", "org": "safir2310", "repo": "AGSI-V-2.0", "ref": "main"}},
)
uid = dep.get("uid") or dep.get("id")
if not uid:
    print("  ✗ deploy gagal dibuat:", json.dumps(dep)[:300]); sys.exit(1)
print(f"  deployment: {uid}")

# ===== [3] polling =====
print("[3] polling (maks ~11 menit)")
state = None
for i in range(32):
    time.sleep(20)
    d = api(f"https://api.vercel.com/v13/deployments/{uid}?teamId={TEAM}")
    state = d.get("readyState")
    print(f"  [{(i+1)*20:4d}s] {state}")
    if state in ("READY", "ERROR", "CANCELED"):
        break
if state != "READY":
    print(f"✗ belum READY (state={state})"); sys.exit(2)
print(f"✓ deploy READY")

# ===== [4] verifikasi =====
print("[4] verifikasi runtime")
B = "https://agsi-v-2-0.vercel.app"
ok = True

# health
try:
    h = json.loads(urllib.request.urlopen(f"{B}/api/health", timeout=40).read())
    print(f"  health: database={h.get('database')} ready={h.get('ready')}")
    ok = ok and h.get("database") is True
except Exception as e:
    print("  health: ✗", e); ok = False

# products
try:
    p = json.loads(urllib.request.urlopen(f"{B}/api/products", timeout=40).read())
    n = len(p.get("products", []))
    print(f"  products: {n} menu (harap 14)")
    ok = ok and n == 14
except Exception as e:
    print("  products: ✗", e); ok = False

# login admin@agsi.test
try:
    req = urllib.request.Request(
        f"{B}/api/auth/login", method="POST",
        data=json.dumps({"email": "admin@agsi.test", "password": "admin123"}).encode(),
        headers={"content-type": "application/json"})
    r = urllib.request.urlopen(req, timeout=40)
    d = json.loads(r.read())
    print(f"  login admin@agsi.test: HTTP {r.status} | role={d.get('user',{}).get('role')}")
    ok = ok and r.status == 200
except urllib.error.HTTPError as e:
    print(f"  login admin@agsi.test: ✗ HTTP {e.code}"); ok = False
except Exception as e:
    print("  login: ✗", e); ok = False

# settings
try:
    s = json.loads(urllib.request.urlopen(f"{B}/api/settings", timeout=40).read())
    print(f"  settings: bannerEnabled={s.get('bannerEnabled')} | deliveryEnabled={s.get('deliveryEnabled')}")
    ok = ok and s.get("bannerEnabled") is True
except Exception as e:
    print("  settings: ✗", e); ok = False

print("\n" + ("✓ SEMUA VERIFIKASI LULUS — produksi hidup di Neon" if ok else "✗ ada yang gagal — periksa di atas"))
sys.exit(0 if ok else 3)

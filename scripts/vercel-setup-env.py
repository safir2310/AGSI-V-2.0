"""
Setup Environment Variables Vercel untuk AGSI POS + redeploy.
Token dibaca dari /tmp/vt (tidak disimpan di repo).
Pakai: python3 scripts/vercel-setup-env.py
"""
import json
import pathlib
import time
import urllib.request

TOKEN = pathlib.Path("/tmp/vt").read_text().strip()
PID = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK"
HDR = {"Authorization": f"Bearer {TOKEN}", "content-type": "application/json"}


def env_value(key: str) -> str:
    """Baca nilai variabel dari .env lokal (kunci tidak pernah ditulis di skrip)."""
    for line in pathlib.Path(".env").read_text().splitlines():
        m = line.strip().split("=", 1)
        if len(m) == 2 and m[0].strip() == key:
            return m[1].strip().strip('"')
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


# ===== 1. Siapkan 11 env =====
sa = json.load(open("upload/agsi-pos-491c8-firebase-adminsdk-fbsvc-b694c45372.json"))
pk = sa["private_key"].replace("\n", "\\n")  # bentuk satu-baris; aplikasi menormalkan

envs = [
    {"key": "RESEND_API_KEY", "value": env_value("RESEND_API_KEY")},
    {"key": "RESEND_FROM", "value": "AGSI POS <onboarding@resend.dev>"},
    {"key": "FIREBASE_PROJECT_ID", "value": sa["project_id"]},
    {"key": "FIREBASE_CLIENT_EMAIL", "value": sa["client_email"]},
    {"key": "FIREBASE_PRIVATE_KEY", "value": pk},
    {"key": "FIREBASE_WEB_API_KEY", "value": env_value("FIREBASE_WEB_API_KEY")},
    {"key": "FIREBASE_AUTH_DOMAIN", "value": env_value("FIREBASE_AUTH_DOMAIN")},
    {"key": "FIREBASE_SENDER_ID", "value": env_value("FIREBASE_SENDER_ID")},
    {"key": "FIREBASE_STORAGE_BUCKET", "value": env_value("FIREBASE_STORAGE_BUCKET")},
    {"key": "FIREBASE_APP_ID", "value": env_value("FIREBASE_APP_ID")},
]
for e in envs:
    e["type"] = "encrypted"
    e["target"] = ["production", "preview"]

res = api(f"https://api.vercel.com/v10/projects/{PID}/env", "POST", envs)
created = res.get("created") or []
print(f"1) env dibuat: {len(created) if created else 'lihat respons'}")
for c in created:
    print("   +", c.get("target") and c.get("key"))

# ===== 2. Redeploy produksi dari deployment READY terakhir =====
deps = api(
    f"https://api.vercel.com/v6/deployments?projectId={PID}&target=production&limit=1&state=READY"
)
dep = deps["deployments"][0]
print(f"2) redeploy dari {dep['uid']} ({dep.get('url')})")
new = api(
    "https://api.vercel.com/v13/deployments",
    "POST",
    {"deploymentId": dep["uid"], "target": "production"},
)
uid = new["uid"]
print(f"   deploy baru: {uid} state={new.get('readyState')}")

# ===== 3. Tunggu sampai READY =====
for i in range(40):
    time.sleep(15)
    d = api(f"https://api.vercel.com/v13/deployments/{uid}")
    state = d.get("readyState")
    print(f"   [{i*15}s] {state}")
    if state == "READY":
        print("3) DEPLOY SIAP:", f"https://{d.get('url')}")
        break
    if state in ("ERROR", "CANCELED"):
        print("3) GAGAL:", state)
        raise SystemExit(1)
else:
    print("3) timeout menunggu deploy")
    raise SystemExit(1)

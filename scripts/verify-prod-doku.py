"""
Verifikasi end-to-end QRIS DOKU di PRODUKSI (agsi-v-2-0.vercel.app):
  1. /api/health
  2. login admin -> token
  3. buat pesanan QRIS
  4. GET /api/orders/{id}/qris  -> provider HARUS "doku" + paymentUrl
     checkout.doku.com (jalur Checkout legacy)
  5. GET /api/orders/{id}/qris/status -> PENDING / ORDER_GENERATED
Pakai: python3 scripts/verify-prod-doku.py
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

BASE = "https://agsi-v-2-0.vercel.app"
# Kredensial admin TIDAK ditulis di repo — baca dari /tmp/agsi-cred
# (file "email\npassword", chmod 600) atau env AGSI_EMAIL/AGSI_PASSWORD.
_cred = pathlib.Path("/tmp/agsi-cred")
if _cred.exists():
    EMAIL, PASSWORD = _cred.read_text().split()[:2]
else:
    EMAIL = os.environ.get("AGSI_EMAIL", "")
    PASSWORD = os.environ.get("AGSI_PASSWORD", "")


if not EMAIL or not PASSWORD:
    sys.exit("Kredensial tidak tersedia (isi /tmp/agsi-cred atau env AGSI_EMAIL/AGSI_PASSWORD)")


def call(path, method="GET", body=None, token=None, expect_json=True):
    hdr = {"content-type": "application/json"}
    if token:
        hdr["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers=hdr,
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if expect_json and raw else raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]


# ===== 1. Health =====
st, h = call("/api/health")
print("1) /api/health ->", st, json.dumps(h)[:200])

# ===== 2. Login =====
st, login = call("/api/auth/login", "POST", {"email": EMAIL, "password": PASSWORD})
token = (login or {}).get("token") if isinstance(login, dict) else None
print("2) login ->", st, "token:", "OK" if token else str(login)[:200])
if not token:
    sys.exit("GAGAL login")

# ===== 3. Buat pesanan QRIS =====
order_body = {
    "items": [{
        "productId": "cmw17kioi0008qs4sugul2hcx",
        "name": "Laos Geprek Sambal Ijo",
        "emoji": "🥩",
        "price": 16000,
        "qty": 1,
    }],
    "orderType": "TAKEAWAY",
    "paymentMethod": "QRIS",
    "customerName": "Uji QRIS DOKU",
    "note": "verifikasi e2e produksi DOKU",
}
st, order = call("/api/orders", "POST", order_body, token)
oid = ((order or {}).get("order") or {}).get("id") if isinstance(order, dict) else None
code = ((order or {}).get("order") or {}).get("code") if isinstance(order, dict) else None
print("3) order ->", st, f"id={oid} code={code}")
if not oid:
    sys.exit(f"GAGAL buat pesanan: {json.dumps(order)[:400]}")

# ===== 4. QRIS =====
st, q = call(f"/api/orders/{oid}/qris", token=token)
if isinstance(q, dict):
    print("4) qris ->", st,
          "provider=", q.get("provider"),
          "mode=", q.get("mode"),
          "autoVerify=", q.get("autoVerify"),
          "amount=", q.get("amount"))
    pl = q.get("payload") or ""
    print("   payload:", (pl[:110] + "…") if len(pl) > 110 else pl)
    print("   paymentUrl:", q.get("paymentUrl"))
    print("   fallbackReason:", q.get("fallbackReason"))
    print("   gatewayError:", q.get("gatewayError"))
else:
    print("4) qris ->", st, str(q)[:300])

# ===== 5. Status =====
st, s = call(f"/api/orders/{oid}/qris/status", token=token)
if isinstance(s, dict):
    print("5) status ->", st,
          "paymentStatus=", s.get("paymentStatus"),
          "providerStatus=", s.get("providerStatus"),
          "paid=", s.get("paid"))
else:
    print("5) status ->", st, str(s)[:300])

print("OID:", oid)
print("SELESAI")

"""
Uji E2E lokal pembayaran E-Wallet DOKU (dev server localhost:3000).
  python3 scripts/test-local-ewallet.py
"""
import json
import urllib.error
import urllib.request

BASE = "http://localhost:3000"


def call(path, method="GET", body=None, token=None):
    hdr = {"content-type": "application/json"}
    if token:
        hdr["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers=hdr,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]


st, login = call("/api/auth/login", "POST", {"email": "admin@agsi.test", "password": "admin123"})
token = login.get("token")
print("login:", st, "OK" if token else login)

# ===== 1) Order EWALLET =====
st, o = call("/api/orders", "POST", {
    "items": [{"name": "Ayam Geprek Sambal Ijo", "emoji": "🍗", "price": 18000, "qty": 1}],
    "orderType": "TAKEAWAY", "paymentMethod": "EWALLET",
    "customerName": "Uji E-Wallet", "note": "e2e ewallet lokal",
}, token)
order = (o or {}).get("order") if isinstance(o, dict) else None
print("order EWALLET:", st, order and (order["id"], order["code"], order["paymentMethod"], order["paymentStatus"]))
oid = order["id"]

st, q = call(f"/api/orders/{oid}/qris", token=token)
print("qris:", st)
if isinstance(q, dict):
    print("  provider   :", q.get("provider"))
    print("  method     :", q.get("paymentMethod"))
    print("  mode       :", q.get("mode"), "autoVerify:", q.get("autoVerify"))
    print("  paymentUrl :", (q.get("paymentUrl") or "")[:90])
    print("  trxId      :", q.get("trxId"))
    print("  fallback   :", q.get("fallbackReason"))

st, s = call(f"/api/orders/{oid}/qris/status", token=token)
print("status:", st, json.dumps(s)[:220])

# ===== 2) Order QRIS (regresi: semua kanal) =====
st, o2 = call("/api/orders", "POST", {
    "items": [{"name": "Es Teh Manis", "emoji": "🧋", "price": 6000, "qty": 2}],
    "orderType": "DINE_IN", "paymentMethod": "QRIS",
    "customerName": "Uji QRIS", "note": "e2e qris lokal regresi",
}, token)
order2 = (o2 or {}).get("order") if isinstance(o2, dict) else None
print("order QRIS:", st, order2 and (order2["id"], order2["code"]))
oid2 = order2["id"]
st, q2 = call(f"/api/orders/{oid2}/qris", token=token)
if isinstance(q2, dict):
    print("qris QRIS: provider=", q2.get("provider"), "method=", q2.get("paymentMethod"))
    print("  paymentUrl :", (q2.get("paymentUrl") or "")[:90])
st, s2 = call(f"/api/orders/{oid2}/qris/status", token=token)
print("status QRIS:", st, json.dumps(s2)[:200])

# ===== 3) Order tunai tidak boleh punya route qris =====
st, o3 = call("/api/orders", "POST", {
    "items": [{"name": "Kerupuk", "emoji": "🍘", "price": 3000, "qty": 1}],
    "orderType": "TAKEAWAY", "paymentMethod": "CASH",
    "customerName": "Uji Tunai",
}, token)
order3 = (o3 or {}).get("order") if isinstance(o3, dict) else None
print("order CASH:", st, order3 and order3["paymentMethod"])
st, q3 = call(f"/api/orders/{order3['id']}/qris", token=token)
print("qris CASH (harus 400):", st, str(q3.get("error") if isinstance(q3, dict) else q3)[:80])
print("SELESAI")

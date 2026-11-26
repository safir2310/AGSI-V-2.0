/**
 * e2e-doku-all.mjs — uji E2E lokal UPDATE pembayaran "semua metode DOKU".
 * Server lokal (SQLite, TANPA kredensial DOKU) → jalur DOKU otomatis gagal
 * dan pesanan jatuh ke fallback QRIS LOCAL — memastikan:
 *   1. Checkout paymentMethod "QRIS" (opsi "Online (DOKU)") diterima.
 *   2. Pesanan EWALLET legacy masih diterima (gate ewalletEnabled).
 *   3. GET /api/orders/[id]/qris tidak 500: mode LOCAL + payload QR tampil.
 * Bila kredensial DOKU ada di lingkungan uji, mode = GATEWAY + provider doku.
 */
const BASE = process.argv[2] ?? "http://localhost:3123";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

const jar = new Map();
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const EMAIL = `doku-e2e-${Date.now()}@agsi.test`;
console.log(`E2E DOKU-ALL vs ${BASE} — akun ${EMAIL}`);

const reg = await api("/api/auth/register", { method: "POST", body: { name: "DOKU Tester", email: EMAIL, phone: "081234567891", password: "DokuE2e5x7z" } });
ok("register", reg.status === 200 || reg.status === 201, `HTTP ${reg.status} ${reg.json?.error ?? ""}`);

const login = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: "DokuE2e5x7z" } });
ok("login", login.status === 200, `HTTP ${login.status}`);

// 1) Checkout opsi "Online (DOKU)" → paymentMethod "QRIS"
const o1 = await api("/api/orders", {
  method: "POST",
  body: {
    type: "TAKEAWAY",
    paymentMethod: "QRIS",
    items: [{ name: "Geprek Test", emoji: "🍗", price: 25000, qty: 1 }],
  },
});
ok("checkout QRIS (Online DOKU) diterima", (o1.status === 200 || o1.status === 201) && o1.json?.order?.id, `HTTP ${o1.status} ${o1.json?.error ?? ""}`);

// 2) Pesanan EWALLET (nilai historis) tetap diterima
const o2 = await api("/api/orders", {
  method: "POST",
  body: {
    type: "TAKEAWAY",
    paymentMethod: "EWALLET",
    items: [{ name: "Geprek Test 2", emoji: "🍗", price: 20000, qty: 1 }],
  },
});
ok("checkout EWALLET legacy diterima", (o2.status === 200 || o2.status === 201) && o2.json?.order?.id, `HTTP ${o2.status} ${o2.json?.error ?? ""}`);

// 3) Kode bayar — LOCAL fallback tanpa kredensial DOKU, tanpa 500
if (o1.json?.order?.id) {
  const q = await api(`/api/orders/${o1.json.order.id}/qris`);
  ok("kode bayar tersedia (LOCAL/GATEWAY)", q.status === 200 && (q.json?.mode === "LOCAL" || q.json?.mode === "GATEWAY"), `mode=${q.json?.mode} provider=${q.json?.provider ?? "-"}`);
  ok("payload pembayaran ada (QR/URL)", typeof q.json?.payload === "string" && q.json.payload.length > 10, `len=${q.json?.payload?.length ?? 0}`);
}

console.log(`\nHASIL: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);

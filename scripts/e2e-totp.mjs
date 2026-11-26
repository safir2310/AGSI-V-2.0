/**
 * e2e-totp.mjs — uji E2E alur "lupa password via Authenticator (TOTP)".
 * Dijalankan terhadap server lokal (default http://localhost:3123) dengan DB
 * SQLite segar. Alur:
 *   1. Register akun baru + login (sesi cookie)
 *   2. GET /api/auth/totp → belum aktif
 *   3. POST /api/auth/totp/setup → secret Base32 (diparse dari otpauthUri)
 *   4. POST /api/auth/totp/verify (kode TOTP dihitung lokal) → aktif
 *   5. POST /api/auth/forgot-password → { mode: "totp" } TANPA kirim email
 *   6. Reset pakai kode SALAH → 400 (attempts naik)
 *   7. POST /api/auth/reset-password (kode TOTP fresh) → ok
 *   8. Login dengan password baru → ok
 * Keluar 0 bila SEMUA asersi lolos.
 */
const BASE = process.argv[2] ?? "http://localhost:3123";
import { createHmac } from "crypto";

const EMAIL = `totp-e2e-${Date.now()}@agsi.test`;
const PASSWORD = "AgsiE2e4x9"; // lolos kebijakan: ≥8, huruf+angka, tanpa urutan 5
const PASSWORD2 = "GeprekTotp8z";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

/* ===== TOTP lokal (algoritma sama dengan src/lib/totp.ts) ===== */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32decode(s) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secretB32, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 30000) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/* ===== HTTP helper dengan cookie jar sederhana ===== */
const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
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
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/* ===== Alur uji ===== */
console.log(`E2E TOTP vs ${BASE} — akun ${EMAIL}`);

const reg = await api("/api/auth/register", { method: "POST", body: { name: "TOTP Tester", email: EMAIL, phone: "081234567890", password: PASSWORD } });
ok("register akun baru", reg.status === 200 || reg.status === 201, `HTTP ${reg.status} ${reg.json?.error ?? ""}`);

const login1 = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
ok("login pertama (sesi)", login1.status === 200, `HTTP ${login1.status}`);

const s0 = await api("/api/auth/totp");
ok("status awal: belum aktif", s0.status === 200 && s0.json.enabled === false, `enabled=${s0.json?.enabled}`);

const setup = await api("/api/auth/totp/setup", { method: "POST" });
const secret = String(setup.json?.otpauthUri ?? "").match(/secret=([^&]+)/)?.[1] ?? "";
ok("setup → secret dari otpauthUri", setup.status === 200 && /^[A-Z2-7]{32}$/.test(secret), `secret len=${secret.length}`);

const v1 = await api("/api/auth/totp/verify", { method: "POST", body: { code: totpCode(secret) } });
ok("verify kode TOTP → aktif", v1.status === 200 && v1.json.enabled === true, `HTTP ${v1.status}`);

const s1 = await api("/api/auth/totp");
ok("status kini: aktif", s1.json.enabled === true && s1.json.pending === false);

const forgot = await api("/api/auth/forgot-password", { method: "POST", body: { email: EMAIL } });
ok("forgot-password → mode totp (tanpa email)", forgot.status === 200 && forgot.json.mode === "totp", `mode=${forgot.json?.mode}`);

const bad = await api("/api/auth/reset-password", { method: "POST", body: { email: EMAIL, code: "000000", newPassword: PASSWORD2 } });
ok("kode salah → ditolak (attempts)", bad.status === 400, `HTTP ${bad.status}`);

// pastikan kode benar-benar "salah": 000000 hanya cocok bila kebetulan kode asli —
// coba sekali lagi dengan kode salah yang beda untuk memastikan penolakan konsisten
const wrongCode = totpCode(secret) === "111111" ? "222222" : "111111";
const bad2 = await api("/api/auth/reset-password", { method: "POST", body: { email: EMAIL, code: wrongCode, newPassword: PASSWORD2 } });
ok("kode salah ke-2 → tetap ditolak", bad2.status === 400, `HTTP ${bad2.status}`);

const good = await api("/api/auth/reset-password", { method: "POST", body: { email: EMAIL, code: totpCode(secret), newPassword: PASSWORD2 } });
ok("reset password dengan kode TOTP → ok", good.status === 200, `HTTP ${good.status}`);

const login2 = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD2 } });
ok("login dengan password BARU", login2.status === 200, `HTTP ${login2.status}`);

const loginOld = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
ok("password LAMA ditolak", loginOld.status !== 200, `HTTP ${loginOld.status}`);

// nonaktifkan authenticator (butuh kode valid) lalu pastikan mode email kembali
const dis = await api("/api/auth/totp", { method: "DELETE", body: { code: totpCode(secret) } });
ok("nonaktif authenticator (kode valid)", dis.status === 200, `HTTP ${dis.status}`);
const forgot2 = await api("/api/auth/forgot-password", { method: "POST", body: { email: EMAIL } });
ok("setelah nonaktif → kembali jalur email", forgot2.json?.mode === undefined, `mode=${forgot2.json?.mode ?? "(email)"}`);

console.log(`\nHASIL: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);

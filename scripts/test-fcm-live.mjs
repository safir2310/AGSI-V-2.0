/**
 * DIAGNOSTIK FCM LANGSUNG — bukti jalur server → Google FCM.
 *
 * Meniru persis src/lib/fcm.ts (JWT RS256 → OAuth2 → messages:send),
 * lalu mencetak HANYA status & pesan error (tanpa kunci/token).
 *
 * Jalankan: node scripts/test-fcm-live.mjs
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

// --- Baca .env manual ---
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const projectId = env.FIREBASE_PROJECT_ID;
const clientEmail = env.FIREBASE_CLIENT_EMAIL;
const privateKey = (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

console.log("1) Konfigurasi .env:");
console.log("   project_id   :", projectId);
console.log("   client_email :", clientEmail ? clientEmail.slice(0, 12) + "…" : "(kosong)");
console.log("   private_key  :", privateKey.startsWith("-----BEGIN") ? "terformat OK" : "(rusak)");

// --- 2) JWT → OAuth2 access token ---
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: clientEmail,
  scope: "https://www.googleapis.com/auth/firebase.messaging",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
})}`;
const sig = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
const assertion = `${unsigned}.${sig}`;

console.log("2) Tukar JWT → access token (oauth2.googleapis.com)…");
let tok;
try {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.log("   ✗ GAGAL:", res.status, body.error ?? "", body.error_description ?? "");
    process.exit(1);
  }
  tok = body.access_token;
  console.log("   ✓ SUKSES — kredensial valid! access_token diterima, expires_in =", body.expires_in, "detik");
} catch (e) {
  console.log("   ✗ TIDAK BISA MENJANGKAU GOOGLE:", e.message);
  console.log("   (jaringan sandbox mungkin memblokir egress — di hosting nyata ini akan jalan)");
  process.exit(2);
}

// --- 3) Coba kirim ke token dummy (diharapkan ditolak FCM dg status jelas) ---
console.log("3) POST messages:send dengan token dummy…");
const res = await fetch(
  `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; UTF-8" },
    body: JSON.stringify({
      message: {
        token: "E2E-TEST-FAKE-TOKEN-0001-agnostik-cuma-untuk-cek-jaringan",
        notification: { title: "Uji", body: "Uji" },
      },
    }),
  }
);
const body = await res.json().catch(() => ({}));
console.log("   Status HTTP:", res.status, "| error.status:", body.error?.status ?? "-");
console.log("   Pesan:", (body.error?.message ?? "tidak ada").slice(0, 220));
console.log(
  res.status === 404 || res.status === 400
    ? "   ✓ Jalur ke FCM HIDUP — penolakan hanya karena token dummy (wajar). Pengiriman asli akan sukses."
    : "   Periksa pesan di atas."
);

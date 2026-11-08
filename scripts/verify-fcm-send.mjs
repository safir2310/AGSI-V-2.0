/**
 * VERIFIKASI JALUR FCM END-TO-END (tanpa mengubah apa pun di app)
 * 1. JWT RS256 (service account) → OAuth2 access_token (scope firebase.messaging)
 * 2. POST validate_only:true  → bukti auth + project + endpoint benar
 * 3. POST nyata ke token PushToken terakhir di db/custom.db → bukti kirim penuh
 *
 * Jalankan: node scripts/verify-fcm-send.mjs
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const uploadDir = resolve(ROOT, "upload");
const saFile = readdirSync(uploadDir).find((f) => /firebase-adminsdk.*\.json$/i.test(f));
const sa = JSON.parse(readFileSync(resolve(uploadDir, saFile), "utf8"));

// env dari .env (baca manual, tidak dicetak)
let projectId = sa.project_id;
let clientEmail = sa.client_email;
let privateKey = sa.private_key;
const envText = existsSync(resolve(ROOT, ".env")) ? readFileSync(resolve(ROOT, ".env"), "utf8") : "";
const m = envText.match(/^FIREBASE_PROJECT_ID=(.*)$/m);
if (m?.[1]?.trim()) projectId = m[1].trim().replace(/^"|"$/g, "");

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

const tokRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${sig}`,
  }),
});
if (!tokRes.ok) {
  console.error(`✗ OAuth gagal HTTP ${tokRes.status}: ${(await tokRes.text()).slice(0, 200)}`);
  process.exit(1);
}
const { access_token: tok } = await tokRes.json();
console.log("1) ✓ OAuth2 access token didapat (scope firebase.messaging)");

const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json; UTF-8" };

// --- 2. validate_only ---
const vRes = await fetch(url, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    message: {
      token: "VALIDASI-FORMAT-SAJA",
      notification: { title: "tes", body: "tes" },
    },
    validate_only: true,
  }),
});
const vBody = await vRes.json().catch(() => ({}));
const vMsg = vBody?.error?.message ?? "";
const authProven = vRes.ok || /not a valid FCM registration token/i.test(vMsg);
if (authProven) {
  console.log(`2) ✓ Kredensial & project '${projectId}' DITERIMA FCM (HTTP ${vRes.status}${vRes.ok ? "" : " — ditolak hanya karena token dummy untuk uji format"})`);
} else {
  console.error(`2) ✗ validate_only HTTP ${vRes.status}:`, JSON.stringify(vBody).slice(0, 300));
  process.exit(1);
}

// --- 3. kirim nyata ke token terakhir di DB ---
let token = null;
try {
  const { Database } = await import("bun:sqlite");
  const db = new Database(resolve(ROOT, "db/custom.db"), { readonly: true });
  const row = db.query("SELECT token, platform, role FROM PushToken ORDER BY createdAt DESC LIMIT 1").get();
  if (row) token = row;
} catch (e) {
  console.log("   (baca DB dilewati:", e.message.slice(0, 80), ")");
}
if (!token) {
  console.log("3) — Tidak ada token perangkat tersimpan; langkah kirim nyata dilewati (perangkat belum pernah daftar).");
  process.exit(0);
}
console.log(`3) Kirim nyata ke token ${token.token.slice(0, 8)}… (${token.platform}/${token.role ?? "-"})`);
const rRes = await fetch(url, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    message: {
      token: token.token,
      notification: { title: "🔔 Push server AGSI aktif!", body: "Verifikasi FCM berhasil — notifikasi ini dikirim otomatis oleh server." },
      webpush: { headers: { Urgency: "high" } },
    },
  }),
});
const rBody = await rRes.json().catch(() => ({}));
if (rRes.ok) {
  console.log(`   ✓ TERKIRIM (HTTP ${rRes.status}, message name: ${rBody.name ?? "-"})`);
  console.log("   → Bila browser itu masih terbuka/minimize, banner heads-up akan muncul.");
} else {
  const status = rBody?.error?.status ?? "";
  const msg = rBody?.error?.message ?? "";
  console.log(`   ✗ HTTP ${rRes.status} ${status}: ${msg.slice(0, 200)}`);
  if (/UNREGISTERED|not a valid FCM registration token|registration-token-not-registered/i.test(msg + status)) {
    console.log("   → Token lama sudah mati (browser reset) — SERVER tetap terbukti benar; perangkat cukup daftar ulang lewat Profil ▸ Notifikasi Push.");
  }
}

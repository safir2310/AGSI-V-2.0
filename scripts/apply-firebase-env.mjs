/**
 * ISI KREDENSIAL FIREBASE KE .env (dari berkas upload/)
 *
 * Sumber:
 *  - upload/agsi-pos-*-firebase-adminsdk-*.json  → kredensial pengiriman (server)
 *  - upload/google-services.json                 → sender id, storage bucket, auth domain
 *  - Firebase Management API (jika jaringan & peran SA mengizinkan)
 *        → daftar Web app → webConfig (apiKey, appId) untuk web push Chrome
 *
 * Menulis .env (backup dulu ke .env.bak), idempoten — aman dijalankan ulang.
 * TIDAK pernah mencetak private key / api key (hanya konfirmasi ter-mask).
 *
 * Jalankan: node scripts/apply-firebase-env.mjs
 */
import { createSign } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, ".env");

// ---------- 1. Temukan berkas kredensial di upload/ ----------
const uploadDir = resolve(ROOT, "upload");
if (!existsSync(uploadDir)) {
  console.error("✗ folder upload/ tidak ada");
  process.exit(1);
}
const files = readdirSync(uploadDir);
const saFile = files.find((f) => /firebase-adminsdk.*\.json$/i.test(f));
const gsFile = files.find((f) => /^google-services\.json$/i.test(f));
if (!saFile) {
  console.error("✗ service account JSON (firebase-adminsdk-*.json) tidak ditemukan di upload/");
  process.exit(1);
}
console.log("1) Berkas kredensial ditemukan:");
console.log("   • service account :", saFile);
console.log("   • google-services :", gsFile ?? "(tidak ada)");

const sa = JSON.parse(readFileSync(resolve(uploadDir, saFile), "utf8"));
const gs = gsFile ? JSON.parse(readFileSync(resolve(uploadDir, gsFile), "utf8")) : null;

const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKeyRaw = sa.private_key; // JANGAN dicetak!
if (!projectId || !clientEmail || !privateKeyRaw?.includes("-----BEGIN")) {
  console.error("✗ service account JSON tidak lengkap (project_id / client_email / private_key)");
  process.exit(1);
}
const privateKeyEnv = `"${privateKeyRaw.replace(/\n/g, "\\n")}"`;

const senderId = gs?.project_info?.project_number ?? null;
const storageBucket = gs?.project_info?.storage_bucket ?? null;
const authDomain = `${projectId}.firebaseapp.com`;

console.log(`   project_id        : ${projectId}`);
console.log(`   client_email      : ${clientEmail}`);
console.log(`   private_key       : <tidak dicetak, len=${privateKeyRaw.length}>`);
console.log(`   sender_id         : ${senderId ?? "-"}`);
console.log(`   storage_bucket    : ${storageBucket ?? "-"}`);
console.log(`   auth_domain       : ${authDomain}`);

// ---------- 2. (Opsional) Discovery Web app via Management API ----------
let webApiKey = null;
let webAppId = null;
try {
  console.log("2) Mencari Web app di project via Firebase Management API…");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const scope = "https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform";
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(privateKeyRaw, "base64url");

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!tokRes.ok) throw new Error(`OAuth HTTP ${tokRes.status}`);
  const { access_token: mgmtToken } = await tokRes.json();
  if (!mgmtToken) throw new Error("token kosong");

  const mgmtHeaders = { Authorization: `Bearer ${mgmtToken}` };
  let list = null;
  let lastErr = "";
  for (const ver of ["v1beta1", "v1alpha"]) {
    const r = await fetch(`https://firebase.googleapis.com/${ver}/projects/${encodeURIComponent(projectId)}/webApps`, { headers: mgmtHeaders });
    if (r.ok) {
      list = await r.json();
      break;
    }
    lastErr = `${ver} HTTP ${r.status}`;
  }
  if (!list) throw new Error(`list webApps gagal (${lastErr})`);
  const apps = list.apps ?? [];
  console.log(`   ditemukan ${apps.length} Web app:`, apps.map((a) => `${a.appId}${a.displayName ? ` (${a.displayName})` : ""}`).join(", ") || "—");
  if (apps.length === 0) throw new Error("NO_WEB_APP");

  // webConfig = GET v1beta1/projects/{p}/webApps/{appId}/config (discovery: flatPath, pattern ^…/config$)
  const cfgRes = await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${apps[0].appId}/config`,
    { headers: mgmtHeaders }
  );
  if (!cfgRes.ok) throw new Error(`webConfig HTTP ${cfgRes.status}`);
  const cfg = await cfgRes.json();
  webApiKey = cfg.apiKey ?? null;
  webAppId = cfg.appId ?? apps[0].appId;
  console.log(`   ✓ webConfig didapat: appId=${webAppId}, apiKey=<len=${webApiKey?.length ?? 0} tidak dicetak>`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "NO_WEB_APP") {
    console.log("   ⚠ Belum ada Web app terdaftar di project Firebase (langkah 2.B di PUSH_SETUP.md).");
  } else {
    console.log(`   ⚠ Discovery dilewati: ${msg}`);
  }
}

// ---------- 3. Tulis .env (backup dulu) ----------
const wanted = {
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_CLIENT_EMAIL: clientEmail,
  FIREBASE_PRIVATE_KEY: privateKeyEnv,
  ...(senderId ? { FIREBASE_SENDER_ID: senderId } : {}),
  ...(storageBucket ? { FIREBASE_STORAGE_BUCKET: storageBucket } : {}),
  FIREBASE_AUTH_DOMAIN: authDomain,
  ...(webApiKey ? { FIREBASE_WEB_API_KEY: webApiKey } : {}),
  ...(webAppId ? { FIREBASE_APP_ID: webAppId } : {}),
};

const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
copyFileSync(ENV_PATH, resolve(ROOT, ".env.bak"));

const kept = current
  .split("\n")
  .filter((line) => line.trim() && !/^\s*(export\s+)?(FIREBASE_[A-Z_]+)\s*=/.test(line));
const next = [...kept, "", "# ===== Firebase Cloud Messaging (lihat PUSH_SETUP.md) =====", ...Object.entries(wanted).map(([k, v]) => `${k}=${v}`), ""].join("\n");
writeFileSync(ENV_PATH, next);

console.log("3) .env diperbarui (backup: .env.bak). Variabel yang diisi:");
for (const k of Object.keys(wanted)) {
  const v = wanted[k];
  const secret = k === "FIREBASE_PRIVATE_KEY" || k === "FIREBASE_WEB_API_KEY";
  console.log(`   ${k}=${secret ? `"<len=${v.length - 2} tidak dicetak>"` : v}`);
}
console.log(
  webApiKey
    ? "✓ SELESAI — server + web push siap. Restart server lalu cek /api/push/config."
    : "✓ Server push siap. Web push Chrome butuh FIREBASE_WEB_API_KEY + FIREBASE_APP_ID (daftar Web app di console) + FIREBASE_VAPID_KEY."
);

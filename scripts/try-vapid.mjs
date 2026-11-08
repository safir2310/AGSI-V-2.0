/**
 * COBA AMBIL WEB PUSH CERTIFICATE (VAPID PUBLIC KEY) PROJECT FIREBASE
 * via Firebase Management/Console API memakai service account upload/.
 *
 * VAPID public key TIDAK rahasia (dikirim ke browser klien via /api/push/config),
 * jadi boleh dicetak bila ditemukan. Private certificate tidak dicetak.
 *
 * Jalankan: node scripts/try-vapid.mjs
 */
import { createSign } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const uploadDir = resolve(ROOT, "upload");
const saFile = readdirSync(uploadDir).find((f) => /firebase-adminsdk.*\.json$/i.test(f));
if (!saFile) {
  console.error("✗ service account tidak ditemukan di upload/");
  process.exit(1);
}
const sa = JSON.parse(readFileSync(resolve(uploadDir, saFile), "utf8"));
const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = sa.private_key;

// --- OAuth token ---
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const scope =
  "https://www.googleapis.com/auth/firebase " +
  "https://www.googleapis.com/auth/cloud-platform";
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
  iss: clientEmail,
  scope,
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
  console.error(`✗ OAuth gagal: HTTP ${tokRes.status}`);
  process.exit(1);
}
const { access_token: tok } = await tokRes.json();
console.log("✓ OAuth token didapat");

// --- Cari semua app (web + android) ---
const apps = [];
const H = { Authorization: `Bearer ${tok}` };
for (const [platform, kind] of [["web", "webApps"], ["android", "androidApps"]]) {
  for (const ver of ["v1beta1", "v1alpha"]) {
    const r = await fetch(`https://firebase.googleapis.com/${ver}/projects/${projectId}/${kind}`, { headers: H });
    if (r.ok) {
      const j = await r.json();
      for (const a of j.apps ?? []) apps.push({ appId: a.appId, platform });
      break;
    }
    const t = await r.text().catch(() => "");
    console.log(`  debug list ${ver} ${kind}: HTTP ${r.status} ${t.slice(0, 200)}`);
  }
}
console.log(`apps: ${apps.map((a) => `${a.platform}:${a.appId}`).join(", ") || "(tidak terbaca)"}`);
if (apps.length === 0) {
  console.error("✗ tidak ada app terdaftar yang terbaca — cek peran service account");
  process.exit(1);
}

// --- Kandidat endpoint Web Push certificate ---
const enc = encodeURIComponent;
const candidates = [];
for (const app of apps) {
  const a = enc(app.appId);
  candidates.push(
    { label: `mgmt v1alpha GET webApps/${a}/webPushCerts`, method: "GET", url: `https://firebase.googleapis.com/v1alpha/projects/${projectId}/webApps/${a}/webPushCerts` },
    { label: `mgmt v1beta1 GET webApps/${a}/webPushCerts`, method: "GET", url: `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps/${a}/webPushCerts` },
    { label: `console v1alpha GET apps/${a}/webPushCerts`, method: "GET", url: `https://firebaseconsole.googleapis.com/v1alpha/projects/${projectId}/apps/${a}/webPushCerts` },
    { label: `console v1 GET apps/${a}/webPushCerts`, method: "GET", url: `https://firebaseconsole.googleapis.com/v1/projects/${projectId}/apps/${a}/webPushCerts` },
  );
}

let found = null;
for (const c of candidates) {
  try {
    const res = await fetch(c.url, { method: c.method, headers: { Authorization: `Bearer ${tok}` } });
    const text = await res.text();
    let body = "";
    try {
      const j = JSON.parse(text);
      body = JSON.stringify(j).slice(0, 300);
    } catch {
      body = text.slice(0, 160).replace(/\s+/g, " ");
    }
    console.log(`[${res.status}] ${c.label} → ${body}`);
    if (res.ok && text.includes("publicKey")) {
      found = JSON.parse(text);
      break;
    }
  } catch (err) {
    console.log(`[ERR] ${c.label} → ${err instanceof Error ? err.message : err}`);
  }
}

if (found) {
  const certs = found.certificates ?? found.webPushCerts ?? [found];
  const c0 = certs[0] ?? {};
  console.log("\n=== VAPID DITEMUKAN ===");
  console.log(`keyId    : ${c0.keyId ?? "-"}`);
  console.log(`publicKey: ${c0.publicKey ?? "-"}`);
  console.log(`status   : ${c0.status ?? "-"}`);
} else {
  console.log("\n✗ Tidak ada endpoint API publik yang mengembalikan VAPID key.");
  console.log("  VAPID key harus diambil manual: Firebase Console → Project settings →");
  console.log("  Cloud Messaging → Web Push certificates → salin Key pair.");
}

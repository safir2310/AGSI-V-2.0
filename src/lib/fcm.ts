import { createSign } from "crypto";

/**
 * KLIEN FCM (Firebase Cloud Messaging) — HTTP v1 API, TANPA dependensi tambahan.
 *
 * Kenapa tulis sendiri? firebase-admin berat (gRPC) dan aplikasi ini cukup
 * mengirim "heads-up push". Implementasi standar resminya:
 *   1. Tandatangani JWT RS256 (service account Firebase) via node:crypto.
 *   2. Tukar JWT → OAuth2 access token di googleapis.com (di-cache sampai habis).
 *   3. POST pesan JSON ke fcm.googleapis.com/v1/projects/{id}/messages:send.
 *
 * Konfigurasi lewat .env (lihat PUSH_SETUP.md):
 *   FIREBASE_PROJECT_ID    = id project Firebase
 *   FIREBASE_CLIENT_EMAIL  = service account ...@...iam.gserviceaccount.com
 *   FIREBASE_PRIVATE_KEY   = private key (boleh satu baris, \n akan diperbaiki)
 *
 * Aman dipanggil walau belum dikonfigurasi — semua fungsi hanya no-op/graceful.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_BASE = "https://fcm.googleapis.com/v1";

type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

/** Baca & validasi env FCM (private key \n dari .env diperbaiki jadi baris baru) */
function readConfig(): FcmConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !rawKey) return null;
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  if (!privateKey.includes("-----BEGIN") || !clientEmail.includes("@")) return null;
  return { projectId, clientEmail, privateKey };
}

/** true bila kredensial push sisi server sudah lengkap di .env */
export function isFcmConfigured(): boolean {
  return readConfig() !== null;
}

// ===== Cache OAuth token (dipakai bersama semua pengiriman) =====
let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function getAccessToken(cfg: FcmConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: cfg.clientEmail,
    scope: OAUTH_SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(cfg.privateKey, "base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Autentikasi Firebase gagal (HTTP ${res.status}). Periksa FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY. ${detail.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Token akses Firebase tidak diterima.");
  cachedToken = {
    value: data.access_token,
    expiresAtMs: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000,
  };
  return cachedToken.value;
}

// ===== Bentuk pesan FCM =====

export type FcmMessage = {
  token: string;
  notification?: { title?: string; body?: string };
  /** semua nilai HARUS string (aturan FCM) */
  data?: Record<string, string>;
  /** config khusus Android — priority HIGH + channel penting = HEADS-UP banner */
  android?: Record<string, unknown>;
  /** config khusus web push — Urgency high = banner heads-up Chrome Android */
  webpush?: Record<string, unknown>;
};

export type FcmSendResult = {
  ok: boolean;
  /** token mati (aplikasi dihapus / browser reset) → boleh dihapus dari DB */
  unregistered?: boolean;
  error?: string;
};

/** Kirim satu pesan ke satu token. Tidak pernah melempar — selalu hasil. */
export async function fcmSend(message: FcmMessage): Promise<FcmSendResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: "FCM belum dikonfigurasi di server (.env)" };
  try {
    const accessToken = await getAccessToken(cfg);
    const res = await fetch(
      `${FCM_BASE}/projects/${encodeURIComponent(cfg.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; UTF-8",
        },
        body: JSON.stringify({ message }),
      }
    );
    if (res.ok) return { ok: true };

    const text = await res.text().catch(() => "");
    let errStatus = "";
    let errMessage = text;
    try {
      const parsed = JSON.parse(text) as { error?: { status?: string; message?: string } };
      errStatus = parsed.error?.status ?? "";
      errMessage = parsed.error?.message ?? text;
    } catch {
      // body bukan JSON — pakai teks mentah
    }
    const unregistered =
      res.status === 404 ||
      res.status === 410 ||
      errStatus === "UNREGISTERED" ||
      /registration-token-not-registered/i.test(errMessage);
    return { ok: false, unregistered, error: `HTTP ${res.status} ${errStatus || errMessage}`.trim() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gagal menghubungi FCM",
    };
  }
}

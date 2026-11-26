/**
 * lib/totp.ts — Authenticator (TOTP) RFC 6238 untuk verifikasi "lupa password".
 *
 * Implementasi murni Node crypto (tanpa dependensi baru):
 *  - Secret 20 byte acak → Base32 (RFC 4648, alfabet A-Z2-7) → cocok untuk
 *    Google Authenticator / Authy / Aegis / 1Password.
 *  - Kode 6 digit HMAC-SHA1, periode 30 detik, jendela verifikasi ±1 langkah
 *    (menoleransi drift jam ringan antara perangkat dan server).
 *  - Secret disimpan ke DB TERENKRIPSI AES-256-GCM; kunci diturunkan dari env
 *    OTP_SECRET (scrypt, salt tetap "agsi-totp-v1") — secret polos tidak pernah
 *    tersimpan maupun dikirim ke klien setelah QR ditampilkan sekali.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;

/* ===== Base32 (RFC 4648) ===== */

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ===== Secret & kode ===== */

/** Secret baru: 20 byte acak → Base32 (panjang 32 karakter). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP RFC 4226: HMAC-SHA1 + dynamic truncation → 6 digit. */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(bin % 1_000_000).padStart(TOTP_DIGITS, "0");
}

/**
 * Verifikasi kode TOTP saat ini (jendela ±`window` langkah, default ±1 = ±30 dtk).
 * Mengembalikan { ok, step } — step = counter yang cocok (bisa disimpan untuk
 * anti-replay bila diperlukan).
 */
export function verifyTotpCode(
  secretB32: string,
  code: string,
  window = 1
): { ok: boolean; step?: number } {
  const clean = String(code ?? "").replace(/\D/g, "");
  if (clean.length !== TOTP_DIGITS) return { ok: false };
  let secret: Buffer;
  try {
    secret = base32Decode(secretB32);
  } catch {
    return { ok: false };
  }
  if (secret.length === 0) return { ok: false };
  const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SEC);
  for (let i = -window; i <= window; i++) {
    const want = hotp(secret, step + i);
    const a = Buffer.from(want);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true, step: step + i };
  }
  return { ok: false };
}

/** URI otpauth:// untuk QR authenticator (issuer + akun + parameter standar). */
export function totpUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/* ===== Enkripsi secret di DB (AES-256-GCM) ===== */

function totpEncKey(): Buffer {
  const seed =
    process.env.OTP_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "agsi-dev-fallback-secret"; // dev lokal tanpa env — JANGAN dipakai produksi
  return scryptSync(seed, "agsi-totp-v1", 32);
}

export function encryptTotpSecret(plainB32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", totpEncKey(), iv);
  const ct = Buffer.concat([cipher.update(plainB32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptTotpSecret(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const [ver, ivB, tagB, ctB] = enc.split(".");
    if (ver !== "v1" || !ivB || !tagB || !ctB) return null;
    const decipher = createDecipheriv("aes-256-gcm", totpEncKey(), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

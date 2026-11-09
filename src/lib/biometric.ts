/**
 * Helper server untuk LOGIN BIOMETRIK (WebAuthn / passkey — sidik jari,
 * Face ID, PIN layar kunci) memakai @simplewebauthn/server.
 *
 * Prinsip keamanan:
 *  - Kunci privat biometrik TIDAK PERNAH meninggalkan perangkat pengguna
 *    (disimpan di secure enclave / keystore oleh platform authenticator).
 *  - Server hanya menyimpan KUNCI PUBLIK + signature counter, lalu
 *    memverifikasi tanda tangan challenge setiap kali pengguna masuk.
 *  - Challenge sekali pakai (TTL 5 menit) disimpan di DB bersama, bukan memori
 *    proses, agar konsisten antar route/worker dan tahan restart server.
 */
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";

/** rpID (hostname) + origin persis seperti yang dilihat browser.
 *  WebAuthn menolak verifikasi bila origin/rpID tidak identik. */
export function rpFromRequest(req: NextRequest): { rpID: string; origin: string } {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000")
    .split(",")[0]
    .trim();
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  const proto =
    forwardedProto ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const rpID = host.split(":")[0];
  return { rpID, origin: `${proto}://${host}` };
}

/**
 * rpID + origin dari origin yang DIKETAHUI BROWSER (`window.location.origin`,
 * dikirim klien). Ini satu-satunya sumber yang benar di belakang proxy/edge
 * yang menulis-ulang Host header: WebAuthn memvalidasi rp.id terhadap origin
 * halaman, bukan terhadap Host yang dilihat server. Bila klien tidak mengirim
 * origin (mis. klien lama), jatuh ke derivasi header.
 */
export function rpFromClientOrigin(
  rawOrigin: unknown,
  req: NextRequest
): { rpID: string; origin: string } {
  if (typeof rawOrigin === "string" && rawOrigin.length <= 253) {
    try {
      const url = new URL(rawOrigin);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.hostname) {
        return { rpID: url.hostname, origin: url.origin };
      }
    } catch {
      // bukan URL valid → pakai fallback header di bawah
    }
  }
  return rpFromRequest(req);
}

// ===== PENYIMPANAN CHALLENGE SEKALI PAKAI (DB, TTL 5 menit) =====
// Challenge TIDAK disimpan di memori proses: Next dev mengisolasi modul per
// route (Map milik route `options` tidak terlihat oleh route `verify`) dan
// restart proses ikut menghapusnya. SQLite bersifat bersama untuk semua route.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Simpan/segarkan challenge (sekali pakai, TTL 5 menit) beserta rpID+origin
 *  persis yang dilihat browser — dipakai lagi saat verifikasi. */
export async function saveChallenge(
  key: string,
  challenge: string,
  rpId?: string,
  origin?: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.biometricChallenge.upsert({
    where: { key },
    create: { key, challenge, rpId: rpId ?? null, origin: origin ?? null, expiresAt },
    update: { challenge, rpId: rpId ?? null, origin: origin ?? null, expiresAt },
  });
  // Pembersihan opportunistic challenge yang sudah kedaluwarsa
  void db.biometricChallenge
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => undefined);
}

export type ChallengeEntry = { challenge: string; rpId: string | null; origin: string | null };

/** Ambil + hapus (sekali pakai). null = tidak ada / kedaluwarsa. */
export async function takeChallengeEntry(key: string): Promise<ChallengeEntry | null> {
  const entry = await db.biometricChallenge.findUnique({ where: { key } });
  if (!entry) return null;
  await db.biometricChallenge.delete({ where: { key } }).catch(() => undefined);
  if (entry.expiresAt.getTime() < Date.now()) return null;
  return { challenge: entry.challenge, rpId: entry.rpId, origin: entry.origin };
}

/** Kunci challenge pendaftaran per user (butuh sesi login) */
export const regChallengeKey = (userId: string) => `reg:${userId}`;
/** Kunci challenge login: per user (dengan email) atau global (tanpa email / passkey discoverable) */
export const authChallengeKey = (userId: string) => `auth:${userId}`;
export const AUTH_DISCOVER_KEY = "auth:discover";

/** Kunci challenge passkey discoverable UNIK per permintaan.
 *  Dua alur login bersamaan (mis. passkey autofill di kolom email + tombol
 *  sidik jari yang ditekan hampir bersamaan) tidak lagi saling menimpa
 *  challenge — klien baru mengembalikan kunci ini saat verify. */
export const newDiscoverKey = () => `auth:discover:${randomUUID()}`;

// ===== KONVERSI KUNCI PUBLIK (Uint8Array <-> base64 untuk disimpan di DB) =====
export function publicKeyToBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

export function base64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(b64, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

/** Nama perangkat ramah dari User-Agent, untuk label daftar kelola */
export function deviceLabelFromUA(ua: string | null): string {
  if (!ua) return "Perangkat ini";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Perangkat";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /SamsungBrowser/i.test(ua)
        ? "Samsung Internet"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Firefox\//i.test(ua)
            ? "Firefox"
            : /Safari\//i.test(ua)
              ? "Safari"
              : "Browser";
  return `${browser} · ${os}`;
}

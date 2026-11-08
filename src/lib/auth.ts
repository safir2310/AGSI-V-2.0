import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "agsi_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  // PENTING: saat aplikasi dibuka di dalam iframe preview (konteks lintas situs),
  // browser TIDAK mengirim cookie SameSite=Lax pada fetch() — server jadi menganggap
  // pengguna belum masuk ("Silakan masuk terlebih dahulu") walau UI sudah login.
  // Solusi: pakai SameSite=None + Secure saat HTTPS, plus fallback token Bearer.
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  const isHttps = proto === "https";
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const h = await headers();
  const authHeader = h.get("authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const cookieToken = jar.get(SESSION_COOKIE)?.value;
  const tokens = [cookieToken, bearerToken].filter((t): t is string => !!t);
  if (tokens.length > 0) {
    await db.session.deleteMany({ where: { token: { in: tokens } } });
  }
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  points: number;
  // ===== PERSETUJUAN KEBIJAKAN DATA =====
  // ISO string atau null — null = belum pernah menyetujui kebijakan
  dataConsentAt: string | null;
  dataConsentVersion: string | null;
  // ===== PERSETUJUAN SYARAT & KETENTUAN APLIKASI =====
  appTermsAt: string | null;
  appTermsVersion: string | null;
};

async function findUserByToken(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    points: u.points,
    dataConsentAt: u.dataConsentAt ? u.dataConsentAt.toISOString() : null,
    dataConsentVersion: u.dataConsentVersion,
    appTermsAt: u.appTermsAt ? u.appTermsAt.toISOString() : null,
    appTermsVersion: u.appTermsVersion,
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  // Jalur 1: cookie sesi (normal, browser langsung)
  const jar = await cookies();
  const fromCookie = await findUserByToken(jar.get(SESSION_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  // Jalur 2 (fallback): header Authorization: Bearer <token>
  // Diperlukan saat cookie diblokir browser (iframe lintas situs / Safari / blokir cookie pihak ketiga).
  const h = await headers();
  const authHeader = h.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return findUserByToken(authHeader.slice(7).trim());
  }
  return null;
}

/** Hapus semua sesi milik user (dipakai setelah reset password agar dipaksa masuk ulang) */
export async function deleteUserSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export function isAdminRole(role?: string | null) {
  return role === "ADMIN" || role === "OWNER";
}

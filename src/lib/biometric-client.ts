"use client";

/**
 * Helper client untuk LOGIN BIOMETRIK (WebAuthn / passkey).
 * Semua interaksi navigator.credentials dibungkus @simplewebauthn/browser
 * agar aman lintas browser (Chrome/Android, Safari/iOS, Windows Hello).
 */
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api";
import type { AppUser } from "@/lib/types";

/** Email akun terakhir yang mengaktifkan biometrik di perangkat ini */
const BIO_EMAIL_KEY = "agsi_biometric_email";

// ===== PEMERIKSAAN LINGKUNGAN (SEBELUM memanggil WebAuthn) =====

type FeaturePolicyLike = { allowsFeature?: (feature: string) => boolean };

/**
 * Browser MEMBLOKIR WebAuthn di iframe cross-origin yang tidak diberi izin
 * `allow="publickey-credentials-create; publickey-credentials-get"` — mis. saat
 * aplikasi dibuka di panel pratinjau tersemat. Penolakannya diam (NotAllowedError
 * tanpa dialog), sehingga pengguna hanya melihat "dibatalkan" yang membingungkan.
 * Deteksi di sini supaya bisa diberi pesan + tombol "Buka di Tab Baru".
 */
function detectEmbeddedFrame(): boolean {
  try {
    if (window.self === window.top) return false; // tab penuh, bukan iframe
    // Di dalam iframe: kalau satu origin dengan induknya, WebAuthn tetap boleh.
    if (window.top && window.top.location.origin === window.location.origin) {
      return false;
    }
  } catch {
    // Membaca window.top.location lintas origin → SecurityError = iframe cross-origin.
  }
  // document.featurePolicy (Chrome) mencerminkan kebijakan efektif iframe ini.
  const fp = (document as Document & { featurePolicy?: FeaturePolicyLike }).featurePolicy;
  if (fp && typeof fp.allowsFeature === "function") {
    return !(
      fp.allowsFeature("publickey-credentials-create") &&
      fp.allowsFeature("publickey-credentials-get")
    );
  }
  // Browser tanpa featurePolicy (Safari/Firefox): iframe tersemat umumnya
  // memblokir WebAuthn → perlakukan sebagai tersemat (konservatif).
  return true;
}

export type BiometricEnvStatus = "ok" | "embedded" | "insecure" | "unsupported";

/** Periksa kesiapan lengkap perangkat + konteks halaman untuk WebAuthn. */
export async function biometricEnvironment(): Promise<BiometricEnvStatus> {
  try {
    if (typeof window === "undefined") return "unsupported";
    // WebAuthn hanya ada di secure context (HTTPS / localhost)
    if (!window.isSecureContext) return "insecure";
    if (detectEmbeddedFrame()) return "embedded";
    if (!browserSupportsWebAuthn()) return "unsupported";
    return (await platformAuthenticatorIsAvailable()) ? "ok" : "unsupported";
  } catch {
    return "unsupported";
  }
}

/** Apakah perangkat + browser ini mendukung login biometrik platform? */
export async function biometricAvailable(): Promise<boolean> {
  return (await biometricEnvironment()) === "ok";
}

/** Pesan ramah per status lingkungan */
export function biometricEnvMessage(status: BiometricEnvStatus): string {
  switch (status) {
    case "embedded":
      return "Aplikasi sedang dibuka di dalam jendela tersemat (mis. panel pratinjau), jadi browser memblokir dialog biometrik. Buka aplikasi di tab browser penuh (Chrome/Safari), login seperti biasa, lalu aktifkan biometrik dari menu Profil.";
    case "insecure":
      return "Login biometrik butuh koneksi aman. Buka ulang aplikasi lewat alamat HTTPS (atau localhost).";
    default:
      return "Perangkat/browser ini belum mendukung login biometrik. Pastikan sidik jari / Face ID aktif, lalu buka lewat Chrome (Android) atau Safari (iPhone).";
  }
}

export function getBiometricEmail(): string | null {
  try {
    return localStorage.getItem(BIO_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setBiometricEmail(email: string) {
  try {
    localStorage.setItem(BIO_EMAIL_KEY, email);
  } catch {
    // abaikan — mode privat dsb.
  }
}

export function clearBiometricEmail() {
  try {
    localStorage.removeItem(BIO_EMAIL_KEY);
  } catch {
    // abaikan
  }
}

export type BiometricFailure = {
  ok: false;
  code: "cancelled" | "error" | "environment";
  message: string;
};

/** Pesan error WebAuthn yang ramah pengguna */
function humanizeWebAuthnError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "TimeoutError":
      return "Pindai biometrik dibatalkan, gagal terbaca, atau waktu tunggu habis. Coba lagi — dan pastikan sidik jari / Face ID sudah terdaftar di pengaturan perangkat.";
    case "InvalidStateError":
      return "Perangkat ini sudah terdaftar di akunmu.";
    case "NotSupportedError":
      return "Browser/perangkat ini belum mendukung login biometrik.";
    case "SecurityError":
      return "Alamat halaman tidak cocok dengan konfigurasi keamanan. Muat ulang halaman (tarik ke bawah / F5), lalu coba lagi.";
    default:
      return err instanceof Error && err.message
        ? err.message
        : "Biometrik tidak dapat diproses.";
  }
}

/** Pemetaan error tak terduga (mis. server tak terjangkau) */
function failureFromUnknown(err: unknown): BiometricFailure {
  // Kegagalan fetch = TypeError (bukan pembatalan oleh pengguna)
  if (err instanceof TypeError) {
    return {
      ok: false,
      code: "error",
      message: "Tidak dapat menghubungi server. Periksa koneksi internet lalu coba lagi.",
    };
  }
  return { ok: false, code: "cancelled", message: humanizeWebAuthnError(err) };
}

/** Daftarkan kredensial biometrik perangkat ini ke akun yang sedang masuk */
export async function registerBiometric(): Promise<
  { ok: true; credentialId: string } | BiometricFailure
> {
  // Preflight: jangan mulai kalau konteks halaman jelas memblokir WebAuthn
  const env = await biometricEnvironment();
  if (env !== "ok") {
    return { ok: false, code: "environment", message: biometricEnvMessage(env) };
  }
  try {
    const optionsRes = await apiFetch("/api/auth/biometric/register/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Origin persis yang dilihat browser — WebAuthn memvalidasi rp.id
      // terhadap origin halaman (Host header di server bisa ditulis-ulang proxy).
      body: JSON.stringify({ origin: window.location.origin }),
    });
    if (!optionsRes.ok) {
      const data = await optionsRes.json().catch(() => ({}));
      return { ok: false, code: "error", message: data.error ?? "Gagal menyiapkan pendaftaran." };
    }
    const optionsJSON = await optionsRes.json();
    const attResp = await startRegistration({ optionsJSON });

    const verifyRes = await apiFetch("/api/auth/biometric/register/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attResp),
    });
    const data = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok) {
      return { ok: false, code: "error", message: data.error ?? "Verifikasi pendaftaran gagal." };
    }
    return { ok: true, credentialId: String(data.credentialId ?? "") };
  } catch (err) {
    return failureFromUnknown(err);
  }
}

/** Masuk dengan biometrik. email opsional — tanpa email, pengguna memilih
 *  akun di dialog biometrik (passkey discoverable). */
export async function loginBiometric(
  email?: string | null
): Promise<{ ok: true; token: string; user: AppUser } | BiometricFailure> {
  // Preflight sama seperti pendaftaran
  const env = await biometricEnvironment();
  if (env !== "ok") {
    return { ok: false, code: "environment", message: biometricEnvMessage(env) };
  }
  try {
    const optionsRes = await fetch("/api/auth/biometric/login/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email ?? null, origin: window.location.origin }),
    });
    if (!optionsRes.ok) {
      const data = await optionsRes.json().catch(() => ({}));
      return { ok: false, code: "error", message: data.error ?? "Login biometrik belum tersedia." };
    }
    const optionsJSON = await optionsRes.json();
    const authResp = await startAuthentication({ optionsJSON });

    const verifyRes = await fetch("/api/auth/biometric/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authResp),
    });
    const data = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok) {
      return { ok: false, code: "error", message: data.error ?? "Verifikasi biometrik gagal." };
    }
    return { ok: true, token: String(data.token), user: data.user as AppUser };
  } catch (err) {
    return failureFromUnknown(err);
  }
}

export type BiometricCredentialInfo = {
  id: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  rpId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Ambil daftar perangkat biometrik akun yang sedang masuk */
export async function listBiometricCredentials(): Promise<BiometricCredentialInfo[]> {
  try {
    const res = await apiFetch("/api/auth/biometric/credentials", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.credentials) ? data.credentials : [];
  } catch {
    return [];
  }
}

/** Hapus satu perangkat biometrik */
export async function deleteBiometricCredential(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/auth/biometric/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

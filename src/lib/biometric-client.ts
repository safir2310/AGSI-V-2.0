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

export type BiometricEnvStatus = "ok" | "embedded" | "insecure" | "unsupported" | "app";

/** Periksa kesiapan lengkap perangkat + konteks halaman untuk WebAuthn. */
export async function biometricEnvironment(): Promise<BiometricEnvStatus> {
  try {
    if (typeof window === "undefined") return "unsupported";
    // Di dalam aplikasi Android AGSI (WebView), biometrik ditangani NATIVE
    // lewat jembatan window.AgsiNative (BiometricPrompt) — bukan WebAuthn.
    if (appBiometricBridge()) return "app";
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
    case "app":
      return "Kamu sedang memakai aplikasi Android AGSI — masuk biometrik di sini ditangani langsung oleh aplikasi (Face ID / sidik jari), bukan WebAuthn browser.";
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
    // challengeKey = kunci challenge milik permintaan ini — dikembalikan saat
    // verify agar alur bersamaan tidak saling menimpa challenge.
    const { challengeKey, ...optionsJSON } = await optionsRes.json();
    const authResp = await startAuthentication({
      optionsJSON: optionsJSON as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });

    const verifyRes = await fetch("/api/auth/biometric/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...authResp, challengeKey }),
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

/**
 * LOGIN PASSKEY via AUTOFILL (conditional mediation) — se-otomatis yang
 * diizinkan browser: TANPA tombol & tanpa dialog modal. Begitu halaman login
 * siap, passkey tersimpan muncul sebagai saran di kolom email (autofill
 * browser); begitu dipilih, sidik jari/Face ID langsung dipindai dan onSuccess
 * dipanggil → masuk akun.
 *
 * Catatan penting: dialog biometrik sistem (mis. "Masuk ke agsi-v-2-0.vercel.app
 * dengan kunci sandi Anda…") TIDAK BISA dihilangkan aplikasi web — Chrome/
 * Android/iOS wajib menampilkan dialog itu karena di DALAM dialog itulah
 * sidik jari dipindai; browser melarang situs membaca biometrik secara senyap.
 * Autofill ini bentuk teringan yang sah: satu ketuk saran → pindai → masuk.
 *
 * Sifatnya PASIF: dipanggil sekali saat halaman login siap; bila browser tidak
 * mendukung conditional mediation atau pengguna tidak memilih passkey, fungsi
 * ini diam saja (tanpa error) sehingga tidak mengganggu login password.
 */
export async function startBiometricAutofill(
  onSuccess: (result: { token: string; user: AppUser }) => void
): Promise<void> {
  const env = await biometricEnvironment();
  if (env !== "ok") return;
  try {
    const optionsRes = await fetch("/api/auth/biometric/login/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: null, origin: window.location.origin }),
    });
    if (!optionsRes.ok) return;
    const { challengeKey, ...optionsJSON } = await optionsRes.json();
    // useBrowserAutofill → navigator.credentials.get({ mediation: "conditional" })
    // Butuh <input autocomplete="username webauthn"> di halaman (ada di AuthView).
    const authResp = await startAuthentication({
      optionsJSON: optionsJSON as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      useBrowserAutofill: true,
    });

    const verifyRes = await fetch("/api/auth/biometric/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...authResp, challengeKey }),
    });
    if (!verifyRes.ok) return;
    const data = await verifyRes.json().catch(() => ({}));
    if (data?.token && data?.user) {
      onSuccess({ token: String(data.token), user: data.user as AppUser });
    }
  } catch {
    // Pasif: batal / tidak didukung / tanpa passkey tersimpan → diam saja.
  }
}

/* ================= MODE APLIKASI ANDROID (JEMBATAN NATIVE) =================
 *
 * Di dalam aplikasi Android AGSI, WebAuthn TIDAK tersedia (WebView tidak
 * mendukung navigator.credentials) — tapi aplikasi menyediakan layar buka
 * kunci biometrik NATIVE (BiometricPrompt: Face ID / sidik jari) yang jauh
 * lebih mulus: sesi login tersimpan aman, dan setiap aplikasi dibuka cukup
 * dipindai. Pengaturannya ada di Profil → Login Biometrik melalui bridge.
 *
 * Kontrak dengan app/src/main/java/com/agsi/app/AgsiNativeBridge.kt:
 *  - AgsiNative.isBiometricAvailable(): "ok" | "not_enrolled" | "no_hardware"
 *  - AgsiNative.isBiometricEnabled(): boolean
 *  - AgsiNative.enableBiometric(cbId)  → hasil via window.__agsiNativeResult
 *  - AgsiNative.disableBiometric(): boolean
 */

type AppBiometricBridge = {
  isBiometricAvailable?: () => string;
  isBiometricEnabled?: () => boolean;
  enableBiometric?: (cbId: string) => void;
  disableBiometric?: () => boolean;
};

/** Ambil jembatan biometrik native — hanya ada di aplikasi Android v1.1.0+ */
function appBiometricBridge(): AppBiometricBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { AgsiNative?: unknown }).AgsiNative;
  if (!b || typeof b !== "object") return null;
  const bridge = b as AppBiometricBridge;
  // Guard versi: aplikasi lama (sebelum 1.1.0) tidak punya metode biometrik
  if (typeof bridge.isBiometricAvailable !== "function") return null;
  return bridge;
}

export type AppBiometricStatus = {
  inApp: boolean;
  available: "ok" | "not_enrolled" | "no_hardware";
  enabled: boolean;
};

/** Status layar buka kunci biometrik di aplikasi (sinkron, tanpa await) */
export function appBiometricStatus(): AppBiometricStatus {
  const bridge = appBiometricBridge();
  if (!bridge) return { inApp: false, available: "no_hardware", enabled: false };
  let available: AppBiometricStatus["available"] = "no_hardware";
  let enabled = false;
  try {
    available = (bridge.isBiometricAvailable?.() ?? "no_hardware") as AppBiometricStatus["available"];
    enabled = bridge.isBiometricEnabled?.() ?? false;
  } catch {
    // bridge error → anggap tidak siap
  }
  return { inApp: true, available, enabled };
}

/** Aktifkan biometrik di aplikasi — dialog verifikasi native, hasil via callback */
export function enableAppBiometric(): Promise<{ ok: boolean; message: string }> {
  const bridge = appBiometricBridge();
  const nativeEnable = bridge?.enableBiometric;
  if (!nativeEnable) {
    return Promise.resolve({
      ok: false,
      message: "Perbarui aplikasi AGSI ke versi terbaru untuk memakai fitur ini.",
    });
  }
  return new Promise((resolve) => {
    const cbId = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const w = window as unknown as {
      __agsiNativeResult?: (payload: { id: string; ok: boolean; message: string }) => void;
    };
    const prev = w.__agsiNativeResult;
    // Pengaman: jangan gantung selamanya bila aplikasi tidak membalas
    const timeout = setTimeout(() => {
      w.__agsiNativeResult = prev;
      resolve({ ok: false, message: "Waktu tunggu habis. Tutup sheet lalu coba lagi ya." });
    }, 120_000);
    w.__agsiNativeResult = (payload) => {
      if (!payload || payload.id !== cbId) {
        prev?.(payload);
        return;
      }
      clearTimeout(timeout);
      w.__agsiNativeResult = prev;
      resolve({ ok: !!payload.ok, message: payload.message ?? "" });
    };
    nativeEnable(cbId);
  });
}

/** Matikan biometrik di aplikasi (langsung, tanpa dialog) */
export function disableAppBiometric(): boolean {
  const bridge = appBiometricBridge();
  try {
    return bridge?.disableBiometric?.() ?? false;
  } catch {
    return false;
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

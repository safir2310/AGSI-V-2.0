"use client";

/**
 * KLIEN PUSH AGSI (web + jembatan aplikasi Android native).
 *
 * Dua jalur perangkat:
 *  1. WEB (Chrome/Firefox dsb.): izin notifikasi → service worker
 *     /firebase-messaging-sw.js → token FCM → daftar ke server
 *     (platform "web"). Heads-up di Chrome Android lewat Urgency "high".
 *  2. ANDROID NATIVE (aplikasi WebView android/…): token FCM dikelola SDK
 *     native; halaman menerima token lewat jembatan JS `window.AgsiNative`
 *     lalu mendaftarkannya dengan sesi login (platform "android") supaya
 *     token mendapat role & target yang benar.
 *
 * Semua fungsi aman dipanggil di lingkungan yang tidak mendukung —
 * kembalikan hasil/lempar pesan Indonesia yang bisa ditampilkan UI.
 */

import { apiFetch } from "@/lib/api";

export type PushWebConfig = {
  apiKey: string;
  authDomain: string | null;
  projectId: string;
  messagingSenderId: string;
  storageBucket: string | null;
  appId: string;
};

export type PushConfig = {
  configured: boolean;
  serverReady: boolean;
  webReady: boolean;
  web: PushWebConfig | null;
  vapidKey: string | null;
};

export type PushStatus = {
  /** aplikasi Android native (WebView dengan AgsiNative) */
  native: boolean;
  supported: boolean; // browser mendukung web push
  permission: "granted" | "denied" | "default";
  /** token web tersimpan di perangkat ini (localStorage) */
  webToken: string | null;
  /** token Android native dari jembatan (bila ada) */
  nativeToken: string | null;
};

const WEB_TOKEN_KEY = "agsi-push-token";

/* ================= KONFIG ================= */

export async function fetchPushConfig(): Promise<PushConfig> {
  const res = await apiFetch("/api/push/config", { cache: "no-store" });
  if (!res.ok) throw new Error("Gagal memuat konfigurasi push dari server.");
  return res.json();
}

/* ================= STATUS ================= */

export function isNativeAndroidApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /AGSIAndroidApp/i.test(navigator.userAgent);
}

type NativeBridge = {
  getFcmToken: () => string;
  getAppVersion?: () => string;
};

export function getNativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { AgsiNative?: unknown }).AgsiNative;
  return b && typeof (b as NativeBridge).getFcmToken === "function" ? (b as NativeBridge) : null;
}

export function webPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "Notification" in window && !!window.PushManager;
}

export function getNotificationPermission(): "granted" | "denied" | "default" {
  if (typeof window === "undefined" || !("Notification" in window)) return "default";
  return Notification.permission;
}

function readStoredWebToken(): string | null {
  try {
    return localStorage.getItem(WEB_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function readPushStatus(): Promise<PushStatus> {
  const bridge = getNativeBridge();
  let nativeToken: string | null = null;
  if (bridge) {
    try {
      nativeToken = bridge.getFcmToken() || null;
    } catch {
      nativeToken = null;
    }
  }
  return {
    native: isNativeAndroidApp(),
    supported: webPushSupported(),
    permission: getNotificationPermission(),
    webToken: readStoredWebToken(),
    nativeToken,
  };
}

/* ================= PENDAFTARAN TOKEN ================= */

async function registerToken(token: string, platform: "web" | "android"): Promise<void> {
  const res = await apiFetch("/api/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Gagal mendaftarkan perangkat ke server.");
  }
}

async function unregisterToken(token: string): Promise<void> {
  await apiFetch("/api/push/register", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

/** Daftarkan token aplikasi Android native (jembatan) dengan sesi login. */
export async function registerNativeTokenIfPresent(): Promise<boolean> {
  const bridge = getNativeBridge();
  if (!bridge) return false;
  let token = "";
  try {
    token = bridge.getFcmToken() || "";
  } catch {
    return false;
  }
  if (!token) return false;
  await registerToken(token, "android");
  return true;
}

/* ================= NOTIFIKASI LATAR BELAKANG (aplikasi Android) =================
 *
 * Aplikasi AGSI (v1.2.7+) menjalankan layanan pemantau latar belakang
 * (NotifPollerService): pesanan baru, update status & chat tetap muncul
 * sebagai notifikasi layar walau aplikasi ditutup — tanpa perlu kredensial
 * Firebase. Status & saklarnya dibuka lewat jembatan AgsiNative; di browser
 * biasa fungsi ini mengembalikan null/false (baris UI disembunyikan).
 */

type PollingBridge = {
  setNotifPolling?: (enabled: boolean) => boolean;
  isNotifPollingEnabled?: () => boolean;
};

function appPollingBridge(): PollingBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { AgsiNative?: unknown }).AgsiNative;
  if (!b || typeof b !== "object") return null;
  return b as PollingBridge;
}

/** true/false = status layanan; null = bukan aplikasi / versi terlalu lama */
export function getNativePollingEnabled(): boolean | null {
  const bridge = appPollingBridge();
  if (typeof bridge?.isNotifPollingEnabled !== "function") return null;
  try {
    return !!bridge.isNotifPollingEnabled?.();
  } catch {
    return null;
  }
}

/** Ubah saklar notifikasi latar belakang di aplikasi. false = gagal/versi lama. */
export function setNativePolling(on: boolean): boolean {
  const bridge = appPollingBridge();
  if (typeof bridge?.setNotifPolling !== "function") return false;
  try {
    return !!bridge.setNotifPolling?.(on);
  } catch {
    return false;
  }
}

/* ================= WEB PUSH (Chrome dsb.) ================= */

/** Inisialisasi Firebase Web (lazy, sekali) → instance Messaging + helper SDK */
async function loadFirebase(cfg: PushWebConfig) {
  const [{ getApp, getApps, initializeApp }, { getMessaging, getToken, deleteToken }] =
    await Promise.all([import("firebase/app"), import("firebase/messaging")]);
  // Sanitasi: FirebaseOptions tidak menerima null — buang field kosong
  const options: Record<string, string> = {
    apiKey: cfg.apiKey,
    projectId: cfg.projectId,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  };
  if (cfg.authDomain) options.authDomain = cfg.authDomain;
  if (cfg.storageBucket) options.storageBucket = cfg.storageBucket;
  const app = getApps().length > 0 ? getApp() : initializeApp(options);
  // SDK v9 modular: getToken/deleteToken = fungsi standalone yang menerima
  // INSTANCE Messaging (hasil getMessaging(app)) — bukan modulnya.
  return { messaging: getMessaging(app), getToken, deleteToken };
}

/**
 * Aktifkan push web: minta izin → pasang SW → ambil token FCM → daftar server.
 * Mengembalikan token (disimpan juga di localStorage untuk status UI).
 */
export async function enableWebPush(cfg: PushConfig): Promise<string> {
  if (!cfg.web) throw new Error("Konfigurasi web push belum diisi di server (.env).");
  if (!webPushSupported()) throw new Error("Browser ini tidak mendukung notifikasi push.");
  if (isNativeAndroidApp()) throw new Error("Perangkat ini memakai aplikasi Android — notifikasi dikelola aplikasi.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Izin notifikasi ditolak. Aktifkan lewat pengaturan situs di browser (ikon 🔒 di bilah alamat).");
  }

  const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const { messaging, getToken } = await loadFirebase(cfg.web);
  const token = await getToken(messaging, {
    vapidKey: cfg.vapidKey ?? undefined,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error("Gagal memperoleh token FCM. Coba muat ulang halaman.");

  await registerToken(token, "web");
  try {
    localStorage.setItem(WEB_TOKEN_KEY, token);
  } catch {
    // tanpa localStorage — push tetap aktif, hanya indikator UI yang kosong
  }
  return token;
}

/** Nonaktifkan push web: hapus token dari server + hapus token FCM lokal. */
export async function disableWebPush(cfg: PushConfig): Promise<void> {
  const stored = readStoredWebToken();
  if (stored) {
    await unregisterToken(stored);
    try {
      localStorage.removeItem(WEB_TOKEN_KEY);
    } catch {
      // abaikan
    }
  }
  if (!cfg.web || !webPushSupported()) return;
  try {
    const { messaging, deleteToken } = await loadFirebase(cfg.web);
    await deleteToken(messaging);
  } catch {
    // token sudah tidak ada / SW terpasang ulang — abaikan
  }
}

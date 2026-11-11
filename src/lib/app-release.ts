"use client";

/**
 * Rilis aplikasi Android AGSI — sumber tunggal versi terbaru & deteksi
 * versi terpasang di perangkat.
 *
 * Kenapa penting: fitur simpan struk / cetak / daftar Face ID di dalam
 * aplikasi butuh jembatan native yang baru ada di APK terbaru. Bila pengguna
 * masih memakai APK lama, tombol-tombol itu TIDAK bisa berfungsi (WebView
 * mengabaikan unduhan blob: dan window.print). Jangan biarkan gagal diam —
 * tampilkan banner pembaruan & panduan unduh.
 *
 * Versi terpasang dibaca dari dua sumber (urut prioritas):
 *  1. Jembatan AgsiNative.getAppVersion() (v1.1.0+)
 *  2. User-Agent suffix " AGSIAndroidApp/<versi>" yang ditempel aplikasi
 */

/** Versi APK terbaru yang tersaji di /agsi-app.apk (sinkron dgn download/) */
export const LATEST_APP_VERSION = "1.2.6";

/** Lokasi APK di situs — diunduh lewat DownloadManager aplikasi (v1.1.0+) */
export const APK_URL = "/agsi-app.apk";

/** Halaman panduan unduh (fallback bila unduhan in-app tidak jalan) */
export const UNDUH_PAGE_URL = "/unduh";

/** Bandingkan dua versi "x.y.z" → -1 / 0 / 1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Versi dari user-agent aplikasi ("…AGSIAndroidApp/1.2.4…") → "1.2.4" | null */
export function parseUaAppVersion(ua: string): string | null {
  const m = ua.match(/AGSIAndroidApp\/(\d+(?:\.\d+){0,2})/);
  return m ? m[1] : null;
}

/** Jalan di aplikasi Android AGSI? (penanda user-agent dari MainActivity) */
export function isAgsiApp(ua?: string): boolean {
  if (typeof navigator === "undefined") return false;
  return /AGSIAndroidApp/i.test(ua ?? navigator.userAgent);
}

/** Versi aplikasi terpasang — bridge dulu, lalu user-agent. null = tidak
 *  terdeteksi (mis. APK sangat lama) dan dianggap perlu pembaruan. */
export function installedAppVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const b = (window as unknown as { AgsiNative?: { getAppVersion?: () => string } }).AgsiNative;
    const v = b?.getAppVersion?.();
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    // bridge error → jatuh ke user-agent
  }
  try {
    return parseUaAppVersion(navigator.userAgent);
  } catch {
    return null;
  }
}

/** Apakah aplikasi terpasang perlu diperbarui ke LATEST_APP_VERSION?
 *  Hanya relevan di dalam aplikasi Android; di browser selalu false. */
export function appUpdateNeeded(): boolean {
  if (!isAgsiApp()) return false;
  const v = installedAppVersion();
  if (!v) return true;
  return compareVersions(v, LATEST_APP_VERSION) < 0;
}

/** Pesan ramah utk tombol yang butuh aplikasi terbaru — dipakai struk,
 *  laporan & Face ID saat bridge native tidak ditemukan di dalam app. */
export function pesanPerluPembaruan(fitur: string, versiMinimal: string): string {
  return `${fitur} di aplikasi tersedia mulai AGSI v${versiMinimal}. Versi aplikasimu${
    installedAppVersion() ? ` (v${installedAppVersion()})` : ""
  } masih lama. Perbarui dulu ya: tap banner "Pembaruan Tersedia" di halaman utama, atau buka ${UNDUH_PAGE_URL} di Chrome HP ini.`;
}

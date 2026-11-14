/**
 * Konstanta rilis aplikasi Android AGSI — modul POLOS (tanpa "use client")
 * agar bisa diimpor dari server component (mis. halaman /unduh) maupun client.
 * Versi terpasang & deteksi pembaruan: src/lib/app-release.ts.
 */

/** Versi APK terbaru yang tersaji di /agsi-app.apk (sinkron dgn download/) */
export const LATEST_APP_VERSION = "1.3.3";

/** Lokasi APK di situs — diunduh lewat DownloadManager aplikasi (v1.1.0+) */
export const APK_URL = "/agsi-app.apk";

/** Halaman panduan unduh (fallback bila unduhan in-app tidak jalan) */
export const UNDUH_PAGE_URL = "/unduh";

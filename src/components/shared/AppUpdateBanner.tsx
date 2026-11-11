"use client";

/**
 * BANNER PEMBARUAN APLIKASI — hanya tampil DI DALAM aplikasi Android AGSI
 * saat versi terpasang lebih lama dari LATEST_APP_VERSION.
 *
 * Tombol "Perbarui" mengarah ke /agsi-app.apk — WebView aplikasi (v1.1.0+)
 * menyerahkan unduhan itu ke DownloadManager Android: notifikasi muncul,
 * setelah selesai ketuk untuk memasang (pemasangan langsung menimpa versi
 * lama; tanda tangan sama, data & sesi login tetap aman).
 *
 * Bila unduhan in-app tidak jalan (aplikasi sangat lama), panduan fallback:
 * buka Chrome di HP → alamat situs + /unduh.
 *
 * Deteksi versi memakai useSyncExternalStore — nilai klien baru dipakai
 * SETELAH hidrasi selesai, jadi bebas hydration mismatch tanpa perlu
 * setState di dalam effect.
 */
import { useCallback, useReducer, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Download, X } from "lucide-react";
import {
  APK_URL,
  LATEST_APP_VERSION,
  UNDUH_PAGE_URL,
  appUpdateNeeded,
  installedAppVersion,
} from "@/lib/app-release";

const DISMISS_KEY = "agsi_update_banner_dismissed";

/** Store statis (tidak pernah berubah sendiri) — hanya jembatan utk snapshot */
const emptySubscribe = () => () => {};

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === LATEST_APP_VERSION;
  } catch {
    return false;
  }
}

export function AppUpdateBanner() {
  const prefersReduced = useReducedMotion();
  // Server & hidrasi pertama: false (tidak tampil). Setelah hidrasi, snapshot
  // klien menentukan: hanya di aplikasi Android dgn versi lebih lama.
  const show = useSyncExternalStore(
    emptySubscribe,
    () => appUpdateNeeded() && !readDismissed(),
    () => false,
  );
  // Tombol tutup menulis localStorage lalu memaksa snapshot dibaca ulang.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, LATEST_APP_VERSION);
    } catch {
      // mode privat → abaikan
    }
    forceUpdate();
  }, []);

  const installed = show ? installedAppVersion() : null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="relative z-30 mx-auto w-full max-w-xl px-4 pt-2"
          role="status"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-600 to-amber-500 px-3.5 py-2.5 text-white shadow-lg shadow-orange-500/25">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
              <Download className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-black leading-tight">
                Pembaruan Aplikasi Tersedia — v{LATEST_APP_VERSION}
              </p>
              <p className="truncate text-[10.5px] font-semibold text-orange-100">
                {installed
                  ? `Versi terpasang v${installed} — cetak struk, laporan & Face ID butuh versi baru`
                  : "Cetak struk, laporan & Face ID butuh versi baru — unduh sekarang"}
              </p>
            </div>
            <a
              href={APK_URL}
              className="press-effect flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-[11px] font-black text-orange-700 shadow-sm transition hover:bg-orange-50"
            >
              <Download className="h-3.5 w-3.5" /> Perbarui
            </a>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Tutup banner pembaruan"
              className="press-effect flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 px-1 text-center text-[9.5px] leading-relaxed text-neutral-400">
            Unduhan tidak mulai? Buka Chrome di HP ini → alamat aplikasi + {UNDUH_PAGE_URL}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

"use client";

import { useEffect } from "react";
import { startRealtime } from "@/lib/realtime";
import { refreshSettings, useOrdersStore } from "@/lib/hooks";
import type { AppUser } from "@/lib/types";

/**
 * 🔁 SYNC BRIDGE — sambungan real-time (SSE) untuk SELURUH halaman.
 *
 * Server (/api/realtime) mengirim event begitu data berubah di database —
 * pesanan baru masuk, pembayaran QRIS terverifikasi webhook, status pesanan
 * diganti, chat baru, KONFIGURASI MOTION STUDIO dipublikasikan — sehingga di
 * SEMUA perangkat (web admin, kasir, pelanggan, kurir, browser & aplikasi
 * Android) daftar pesanan, badge & animasi segar dalam ±1–6 detik, tanpa
 * menunggu polling 8–20 detik:
 *  - event "orders" → daftar pesanan segar PAKSA sesuai peran
 *    (admin/owner/kasir = scope "all", lainnya = "mine");
 *  - event "settings" → snapshot pengaturan dimuat ulang (motion studio
 *    publish/restore/reset — efek baru langsung hidup di semua halaman);
 *  - semua event juga diteruskan ke watcher notifikasi (NotifWatchers
 *    memicu tick: kabar + suara + badge instan).
 * Polling interval lama tetap berjalan sebagai jaring pengaman.
 */
export function SyncBridge({ user }: { user: AppUser }) {
  useEffect(() => {
    startRealtime();
    const staffView =
      user.role === "ADMIN" || user.role === "OWNER" || user.role === "CASHIER";
    const onSync = (e: Event) => {
      const d = (e as CustomEvent).detail as { scope?: string } | null;
      if (!d) return;
      if (d.scope === "settings") {
        void refreshSettings();
        return;
      }
      if (d.scope !== "orders") return;
      void useOrdersStore.getState().load(staffView ? "all" : "mine", true);
    };
    window.addEventListener("agsi-sync", onSync);
    return () => window.removeEventListener("agsi-sync", onSync);
  }, [user.role]);
  return null;
}

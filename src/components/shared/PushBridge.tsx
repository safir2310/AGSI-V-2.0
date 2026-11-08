"use client";

import { useEffect } from "react";
import { useAppStore, useNoticeStore, useUiStore } from "@/lib/store";
import { playAgsiChat, playAgsiOrder, playAgsiStatus } from "@/lib/sound";
import { registerNativeTokenIfPresent } from "@/lib/push-client";
import type { AppUser } from "@/lib/types";

/**
 * JEMBATAN PUSH DI APPSHELL — dipasang sekali di AppShell ({user && …}).
 *
 * 1. Registrasi token ANDROID NATIVE: saat aplikasi web dibuka di dalam
 *    WebView aplikasi Android (android/…), SDK FCM native menyiapkan token
 *    dan mengeksposnya lewat jembatan JS `AgsiNative`. Setelah pengguna
 *    MASUK, token didaftarkan ke server (platform "android") supaya
 *    mendapat userId & role — target push per peran jadi akurat.
 *    (Sebelum login, PushService native sudah mendaftarkannya anonim.)
 *
 * 2. PUSH saat aplikasi TERBUKA: service worker meneruskan pesan
 *    "AGSI_PUSH" ke halaman → tampil popup notifikasi AGSI + suara khas
 *    (bunyi sama dengan watcher in-app, sumbernya kini FCM).
 */

export function PushBridge({ user }: { user: AppUser }) {
  const showNotice = useNoticeStore((s) => s.show);

  // 1) Ikat token perangkat Android native ke sesi yang sedang masuk
  useEffect(() => {
    void (async () => {
      try {
        await registerNativeTokenIfPresent();
      } catch {
        // token belum siap / jaringan gagal — PushService native & sesi berikut
        // akan mencoba lagi otomatis
      }
    })();
  }, [user.id]);

  // 2) Pesan push saat aplikasi tampil di depan (dikirim service worker)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const d = event.data as
        | { type?: string; title?: string; body?: string; url?: string; kind?: string }
        | null;
      if (!d || d.type !== "AGSI_PUSH" || !d.title) return;

      const kind = d.kind ?? "info";
      if (kind === "new_order") playAgsiOrder();
      else if (kind === "chat") playAgsiChat();
      else playAgsiStatus();

      const isError = kind === "order_status" && /dibatalkan/i.test(d.title);
      const actions =
        kind === "chat"
          ? [
              { label: "Buka Chat", onClick: () => useUiStore.getState().openChat() },
              { label: "Tutup" },
            ]
          : [
              {
                label: "Lihat Pesanan",
                onClick: () => useAppStore.getState().go("orders"),
              },
              { label: "Tutup" },
            ];

      showNotice({
        type: isError ? "error" : kind === "chat" ? "info" : "success",
        mascot: kind === "new_order" || kind === "order_paid",
        autoCloseMs: 9000,
        title: d.title,
        message: d.body ?? "",
        actions,
      });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [showNotice]);

  return null;
}

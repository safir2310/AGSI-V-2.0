"use client";

import { useEffect } from "react";
import { useAppStore, useUiStore } from "@/lib/store";
import { notifySuite, type SuiteKind } from "@/lib/notif-suite";
import { playAgsiChat, playAgsiOrder, playAgsiStatus } from "@/lib/sound";
import { isNativeAndroidApp, registerNativeTokenIfPresent } from "@/lib/push-client";
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
      // v1.3.14 — di APLIKASI ANDROID: kartu notifikasi dibuat native di
      // status bar (PushService); jalur web-push browser tidak dipakai agar
      // tidak ada kartu/tampilan dobel. (Jalur ini untuk browser murni.)
      if (isNativeAndroidApp()) return;

      const kind = d.kind ?? "info";
      if (kind === "new_order") playAgsiOrder();
      else if (kind === "chat") playAgsiChat();
      else playAgsiStatus();

      const isError = kind === "order_status" && /dibatalkan/i.test(d.title);
      // Kurir: notifikasi tugas antaran membuka beranda kurir, bukan daftar pesanan
      const isCourierTask = kind === "courier_task";
      const actions =
        kind === "chat"
          ? [
              { label: "Buka Chat", onClick: () => useUiStore.getState().openChat() },
              { label: "Tutup" },
            ]
          : [
              {
                label: isCourierTask ? "Buka Tugas" : "Lihat Pesanan",
                onClick: () =>
                  useAppStore.getState().go(isCourierTask && user.role === "COURIER" ? "kurir" : "orders"),
              },
              { label: "Tutup" },
            ];

      // v1.3.13 — SUITE 5 GAYA: pesanan baru/pembayaran → POPUP tengah +
      // heads-up + banner + gelembung; lainnya → heads-up + banner + gelembung.
      const suiteKind: SuiteKind =
        kind === "new_order" ||
        kind === "order_paid" ||
        kind === "order_status" ||
        kind === "chat" ||
        kind === "courier_task"
          ? kind
          : "info";
      const url =
        kind === "chat"
          ? "/chat"
          : isCourierTask && user.role === "COURIER"
            ? "/kurir"
            : "/orders";
      notifySuite(
        { kind: suiteKind, title: d.title, body: d.body ?? "", url },
        kind === "new_order" || kind === "order_paid" ? "critical" : "important",
        kind === "new_order" || kind === "order_paid"
          ? {
              type: isError ? "error" : "success",
              mascot: true,
              title: d.title,
              message: d.body ?? "",
              actions,
            }
          : undefined,
      );
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [user.role]);

  return null;
}

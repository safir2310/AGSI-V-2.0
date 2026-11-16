"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useAppStore, useUiStore, type NoticeType } from "@/lib/store";
import { notifySuite } from "@/lib/notif-suite";
import { recordBrowserEntry } from "@/lib/notif-center";
import { isNativeAndroidApp } from "@/lib/push-client";
import { useOrdersStore } from "@/lib/hooks";
import { formatIDR, type AppUser, type OrderData } from "@/lib/types";
import { playAgsiChat, playAgsiOrder, playAgsiStatus } from "@/lib/sound";

/**
 * 🔔 WATCHER NOTIFIKASI MASUK (segarkan data + tampilan notifikasi halaman)
 *
 * - AdminNewOrderWatcher : polling daftar pesanan (scope=all) tiap 10 detik.
 *   Pesanan yang BELUM pernah terlihat & benar-benar baru (≤ 3 menit) →
 *   kabar penting. Pesanan QRIS aplikasi yang belum dibayar tidak pernah
 *   dikirim server, jadi kabar hanya muncul untuk pesanan yang sudah
 *   benar-benar "masuk".
 * - CustomerNotifWatcher : polling pesanan sendiri (scope=mine) tiap 8 detik.
 *   Perubahan status pesanan (dimasak, siap, selesai, batal) dan dana QRIS.
 * - ChatNotifWatcher    : polling hitungan chat belum dibaca tiap 8 detik
 *   untuk PELANGGAN (balasan CS) sekaligus ADMIN/OWNER (pesan pelanggan
 *   baru). Badge di header ikut menyala karena polling yang sama.
 *
 * v1.3.14 — PEMBAGIAN JALUR TAMPILAN (permintaan pemilik: notifikasi muncul
 * di STATUS BAR, bukan di dalam aplikasi):
 *  - APLIKASI ANDROID (native): kartu notifikasi dibuat NATIVE di status bar
 *    (PushService — heads-up + suara khas AGSI + getar + layar kunci) —
 *    watcher di sini HANYA segarkan data (daftar pesanan, badge chat),
 *    TANPA popup/suite di dalam halaman & TANPA suara web (anti dobel).
 *  - BROWSER: suite notifikasi in-app (notifySuite) + suara web tetap jalan.
 *
 * Polling pertama hanya menandai baseline (tidak memunculkan kabar lama).
 */

/** Popup hanya untuk pesanan yang dibuat maksimal 3 menit lalu (anti bising saat reload) */
const FRESH_WINDOW_MS = 3 * 60 * 1000;

/** true = halaman berjalan di dalam aplikasi Android native (WebView) —
 *  kartu notifikasi dibuat native di status bar, bukan di dalam halaman. */
const NATIVE_APP = isNativeAndroidApp();

/* ===== TICK INSTAN: push FCM (agsi-push) & SSE real-time (agsi-sync) =====
 * Dua sumber memicu tick watcher TANPA menunggu interval polling 8–10 detik:
 *  - "agsi-push" — push FCM diteruskan aplikasi Android saat TERBUKA
 *    (MainActivity → evaluateJavascript) → SEMUA tick dijalankan.
 *  - "agsi-sync" — sinkronisasi real-time SSE (/api/realtime): server
 *    memberi tahu begitu data berubah di database (±1–2 detik) dengan
 *    lingkup "orders" / "chat" → hanya tick terkait yang dijalankan.
 * Setiap watcher mendaftarkan tick-nya beserta lingkup di sini. Di browser
 * murni "agsi-push" tidak pernah menyala — polling tetap jalur cadangan;
 * saat aplikasi di latar belakang, notifikasi sistem FCM yang bekerja dan
 * watcher menangkap perubahan saat halaman kembali aktif. */
type PushTick = { fn: () => void; scopes: Array<"orders" | "chat"> };
const pushTicks = new Set<PushTick>();
function fireTicks(scope?: "orders" | "chat") {
  for (const t of pushTicks) if (!scope || t.scopes.includes(scope)) void t.fn();
}
if (typeof window !== "undefined") {
  window.addEventListener("agsi-push", () => fireTicks());
  window.addEventListener("agsi-sync", (e) => {
    const d = (e as CustomEvent).detail as { scope?: "orders" | "chat" } | null;
    fireTicks(d?.scope);
  });
}

function isAdmin(role: string) {
  return role === "ADMIN" || role === "OWNER";
}

/* ================= ADMIN: POPUP PESANAN BARU MASUK ================= */

export function AdminNewOrderWatcher({ user }: { user: AppUser }) {
  const go = useAppStore((s) => s.go);
  const admin = isAdmin(user.role);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    let seeded = false;
    const seen = new Set<string>();
    const notified = new Set<string>();

    const tick = async () => {
      try {
        const res = await apiFetch("/api/orders?scope=all", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const data = await res.json();
        const orders = (data.orders ?? []) as OrderData[];

        // Polling pertama: tandai semua yang sudah ada sebagai "baseline"
        if (!seeded) {
          seeded = true;
          for (const o of orders) seen.add(o.id);
          return;
        }

        const now = Date.now();
        const fresh = orders.filter(
          (o) =>
            !seen.has(o.id) &&
            !notified.has(o.id) &&
            now - new Date(o.createdAt).getTime() < FRESH_WINDOW_MS &&
            o.status !== "CANCELLED"
        );
        for (const o of orders) seen.add(o.id);
        if (fresh.length === 0) return;
        for (const o of fresh) notified.add(o.id);

        // Segarkan daftar pesanan → badge tab "Pesanan" di navigasi bawah
        // langsung menyala tanpa menunggu refresh manual.
        void useOrdersStore.getState().load("all");

        // v1.3.14 — di APLIKASI ANDROID kartu dibuat native di STATUS BAR
        // (PushService) → halaman cukup segarkan data: tanpa suara web,
        // tanpa suite in-app, tanpa rekaman Pusat Notifikasi dobel (kartu
        // native sudah direkam). Di browser: jalur penuh di bawah.
        if (!NATIVE_APP) {
          // 🔔 SUARA KHAS AGSI — nyaring
          playAgsiOrder();

          // Daftar dari server urut terbaru dulu → fresh[0] = paling baru
          const t = fresh[0];
          const ringkas = t.items.map((i) => `${i.name} ×${i.qty}`).join(" • ");
          // SUITE 5 GAYA (v1.3.13): POPUP tengah (kritis) + HEADS-UP + BANNER
          // + FLOATING gelembung muncul BERSAMAAN untuk pesanan baru masuk.
          notifySuite(
            {
              kind: "new_order",
              title:
                fresh.length > 1
                  ? `🔔 ${fresh.length} Pesanan Baru Masuk!`
                  : "🔔 Pesanan Baru Masuk!",
              body: `${t.code} • ${t.customerName}${
                t.tableNo ? ` (Meja ${t.tableNo})` : ""
              } • ${formatIDR(t.total)} — ${ringkas}`,
              url: "/orders",
            },
            "critical",
            {
              type: "success",
              mascot: true,
              title:
                fresh.length > 1
                  ? `🔔 ${fresh.length} Pesanan Baru Masuk!`
                  : "🔔 Pesanan Baru Masuk!",
              message:
                fresh.length > 1
                  ? `Terbaru: ${t.code} — ${t.customerName}${
                      t.tableNo ? ` (Meja ${t.tableNo})` : ""
                    } • ${formatIDR(t.total)}\n${ringkas}\nSegera diproses ya!`
                  : `${t.code} • ${t.customerName}${
                      t.tableNo ? ` • Meja ${t.tableNo}` : ""
                    } • ${formatIDR(t.total)}\n${ringkas}`,
              actions: [
                { label: "Lihat Pesanan", onClick: () => go("orders") },
                { label: "Nanti" },
              ],
            },
          );

          // 🗂️ Pusat notifikasi (browser): rekam tiap pesanan baru masuk
          for (const o of fresh) {
            recordBrowserEntry({
              ts: Date.now(),
              kind: "new_order",
              tag: o.id,
              title: "🔔 Pesanan Baru Masuk!",
              body: `${o.code} • ${o.customerName}${o.tableNo ? ` (Meja ${o.tableNo})` : ""} • ${formatIDR(o.total)}`,
              url: "/orders",
            });
          }
        }
      } catch {
        // offline — coba lagi di tick berikutnya
      }
    };

    void tick();
    const reg = { fn: tick, scopes: ["orders"] as Array<"orders" | "chat"> };
    pushTicks.add(reg); // push FCM & SSE real-time → tick instan (kabar real-time)
    const iv = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(iv);
      pushTicks.delete(reg);
    };
  }, [admin, go]);

  return null;
}

/* ================= PELANGGAN: UPDATE STATUS + CHAT MASUK ================= */

function statusNotif(o: OrderData): {
  type: NoticeType;
  title: string;
  message: string;
  mascot?: boolean;
} {
  // Dana QRIS baru terverifikasi padahal status masih menunggu → kabari masuk dapur
  if (
    o.paymentStatus === "PAID" &&
    o.status === "PENDING" &&
    (o.paymentMethod === "QRIS" || o.paymentMethod === "EWALLET")
  ) {
    return {
      type: "success",
      title: "💳 Pembayaran Diterima!",
      message: `Dana pesanan ${o.code} sudah masuk. Pesanan otomatis lanjut ke dapur — pantau di menu Pesanan ya!`,
    };
  }
  switch (o.status) {
    case "PREPARING":
      return {
        type: "info",
        title: "👨‍🍳 Pesanan Sedang Dimasak",
        message: `Pesanannya ${o.code} sedang digeprek chef! Sambal ijo disiapkan segar ya 🌶️`,
      };
    case "READY":
      return {
        type: "success",
        mascot: true,
        title: "🔔 Pesanan Siap!",
        message: `${o.code} sudah SIAP${
          o.type === "DELIVERY"
            ? " — kurir segera mengantar."
            : o.type === "TAKEAWAY"
              ? " — silakan diambil di kasir."
              : " — silakan dinikmati di mejamu."
        } Selamat makan!`,
      };
    case "COMPLETED":
      return {
        type: "success",
        mascot: true,
        title: "🎉 Pesanan Selesai",
        message: `Pesanan ${o.code} selesai. Terima kasih sudah makan di AGSI — poin member juga sudah masuk!`,
      };
    case "CANCELLED":
      return {
        type: "error",
        title: "Pesanan Dibatalkan",
        message: `Pesanan ${o.code} dibatalkan${
          (o.paymentMethod === "QRIS" || o.paymentMethod === "EWALLET") &&
          o.paymentStatus === "UNPAID"
            ? " karena pembayaran tidak diterima dalam 5 menit. Voucher yang terpakai sudah dikembalikan."
            : ". Bila merasa keliru, hubungi CS lewat menu Chat ya."
        }`,
      };
    default:
      return {
        type: "info",
        title: "Status Pesanan Diperbarui",
        message: `Status pesanan ${o.code} kini diperbarui. Cek menu Pesanan untuk detailnya.`,
      };
  }
}

export function CustomerNotifWatcher({ user }: { user: AppUser }) {
  const go = useAppStore((s) => s.go);
  const customer = user.role === "CUSTOMER";

  useEffect(() => {
    if (!customer) return;
    let alive = true;
    let seededOrders = false;
    const prevStatus = new Map<string, { status: string; paymentStatus: string }>();

    const tick = async () => {
      if (!alive) return;

      // ---- Perubahan status/pembayaran pesanan sendiri ----
      try {
        const res = await apiFetch("/api/orders?scope=mine", { cache: "no-store" });
        if (alive && res.ok) {
          const data = await res.json();
          const orders = (data.orders ?? []) as OrderData[];
          if (!seededOrders) {
            seededOrders = true; // baseline, tanpa popup
          } else {
            const changes: OrderData[] = [];
            for (const o of orders) {
              const prev = prevStatus.get(o.id);
              if (!prev) continue;
              if (prev.status !== o.status) changes.push(o);
              else if (prev.paymentStatus !== o.paymentStatus && o.paymentStatus === "PAID")
                changes.push(o);
            }
            if (changes.length > 0) {
              // Segarkan daftar pesanan → badge tab "Pesanan" & daftar ikut segar
              void useOrdersStore.getState().load("mine");

              // v1.3.14 — di APLIKASI ANDROID kartu dibuat native di STATUS
              // BAR (PushService) → halaman cukup segarkan data. Browser:
              // SUITE 5 GAYA (v1.3.13) — momen KRITIS (pembayaran masuk &
              // pesanan SIAP) POPUP tengah + heads-up + banner + gelembung;
              // pembaruan lain cukup heads-up + banner + gelembung.
              if (!NATIVE_APP) {
                playAgsiStatus();
                const n = statusNotif(changes[0]);
                const c0 = changes[0];
                const critical = c0.paymentStatus === "PAID" || c0.status === "READY";
                notifySuite(
                  {
                    kind: c0.paymentStatus === "PAID" ? "order_paid" : "order_status",
                    title: n.title,
                    body: n.message,
                    url: "/orders",
                  },
                  critical ? "critical" : "important",
                  critical
                    ? {
                        type: n.type,
                        mascot: n.mascot,
                        title: n.title,
                        message: n.message,
                        actions: [
                          { label: "Lihat Pesanan", onClick: () => go("orders") },
                          { label: "Tutup" },
                        ],
                      }
                    : undefined,
                );

                // 🗂️ Pusat notifikasi (browser): rekam tiap perubahan status/pembayaran
                for (const c of changes) {
                  const n2 = statusNotif(c);
                  recordBrowserEntry({
                    ts: Date.now(),
                    kind: c.paymentStatus === "PAID" ? "order_paid" : "order_status",
                    tag: c.id,
                    title: n2.title,
                    body: n2.message,
                    url: "/orders",
                  });
                }
              }
            }
          }
          for (const o of orders)
            prevStatus.set(o.id, { status: o.status, paymentStatus: o.paymentStatus });
        }
      } catch {
        // offline — coba lagi nanti
      }
    };

    void tick();
    const reg = { fn: tick, scopes: ["orders"] as Array<"orders" | "chat"> };
    pushTicks.add(reg); // push FCM & SSE real-time → tick instan (kabar real-time)
    const iv = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(iv);
      pushTicks.delete(reg);
    };
  }, [customer, go]);

  return null;
}

/* ================= CHAT MASUK: PELANGGAN & ADMIN/CS ================= */

/**
 * Pantau hitungan chat belum dibaca:
 *   - Pelanggan : balasan CS baru masuk → popup "💬 Pesan Baru dari CS".
 *   - Admin/CS  : pesan pelanggan baru masuk → popup "💬 Chat Pelanggan Baru"
 *     (sebelumnya admin hanya tahu lewat badge di halaman profil — kini
 *     langsung muncul popup + suara di halaman mana pun, termasuk profil).
 * Bila sheet chat sedang terbuka, pesan dianggap sudah dibaca → tidak bunyi.
 */
export function ChatNotifWatcher({ user }: { user: AppUser }) {
  const staff = isAdmin(user.role);
  const enabled = staff || user.role === "CUSTOMER";

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let prevUnread: number | null = null;

    const tick = async () => {
      if (!alive) return;
      try {
        const res = await apiFetch("/api/chat/unread", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const data = await res.json();
        const unread = typeof data.unread === "number" ? data.unread : 0;
        // Simpan ke store global → badge lonceng notifikasi di header menyala
        useUiStore.getState().setChatUnread(unread);
        const chatOpen = useUiStore.getState().chatOpen;
        // Sedang membuka chat → pesan dianggap dibaca, jangan bunyi
        if (prevUnread !== null && unread > prevUnread && !chatOpen) {
        // v1.3.14 — di APLIKASI ANDROID kartu dibuat native di STATUS BAR
        // (PushService) → halaman cukup segarkan data & badge. Browser:
        // SUITE 5 GAYA (v1.3.13) — chat masuk → HEADS-UP + BANNER + FLOATING
        // (tanpa popup tengah — overlay chat punya pintu sendiri).
        if (!NATIVE_APP) {
          playAgsiChat();
          // 🗂️ Pusat notifikasi (browser): rekam chat masuk
          recordBrowserEntry({
            ts: Date.now(),
            kind: "chat",
            title: staff ? "💬 Chat Pelanggan Baru!" : "💬 Pesan Baru dari CS",
            body:
              unread > 1
                ? `${unread} pesan menunggumu di chat AGSI.`
                : "Ada pesan baru di chat AGSI.",
            url: "/chat",
          });
          notifySuite(
            {
              kind: "chat",
              title: staff ? "💬 Chat Pelanggan Baru!" : "💬 Pesan Baru dari CS",
              body:
                unread > 1
                  ? `${unread} pesan menunggumu di chat AGSI.`
                  : staff
                    ? "Seorang pelanggan baru mengirim pesan — segera dibalas ya!"
                    : "CS AGSI membalas pesanmu — cek sekarang ya!",
              url: "/chat",
            },
            "important",
          );
        }
        }
        prevUnread = unread;
      } catch {
        // offline — coba lagi nanti
      }
    };

    void tick();
    const reg = { fn: tick, scopes: ["chat"] as Array<"orders" | "chat"> };
    pushTicks.add(reg); // push FCM & SSE real-time → tick instan (badge & kabar chat)
    const iv = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(iv);
      pushTicks.delete(reg);
    };
  }, [enabled, staff]);

  return null;
}

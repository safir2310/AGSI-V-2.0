"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useAppStore, useNoticeStore, useUiStore, type NoticeType } from "@/lib/store";
import { useOrdersStore } from "@/lib/hooks";
import { formatIDR, type AppUser, type OrderData } from "@/lib/types";
import { playAgsiChat, playAgsiOrder, playAgsiStatus } from "@/lib/sound";

/**
 * 🔔 WATCHER NOTIFIKASI MASUK (popup + suara khas AGSI)
 *
 * - AdminNewOrderWatcher : polling daftar pesanan (scope=all) tiap 10 detik.
 *   Pesanan yang BELUM pernah terlihat & benar-benar baru (≤ 3 menit) →
 *   popup besar + BEL DAPUR AGSI yang nyaring. Pesanan QRIS aplikasi yang
 *   belum dibayar tidak pernah dikirim server, jadi popup hanya muncul untuk
 *   pesanan yang sudah benar-benar "masuk".
 * - CustomerNotifWatcher : polling pesanan sendiri (scope=mine) tiap 8 detik.
 *   Perubahan status pesanan (dimasak, siap, selesai, batal) dan dana QRIS
 *   masuk → popup + senar AGSI.
 * - ChatNotifWatcher    : polling hitungan chat belum dibaca tiap 8 detik
 *   untuk PELANGGAN (balasan CS) sekaligus ADMIN/OWNER (pesan pelanggan
 *   baru). Chat masuk → popup + blip AGSI + tombol "Buka Chat". Badge di
 *   halaman profil ikut menyala karena polling yang sama.
 *
 * Polling pertama hanya menandai baseline (tidak memunculkan popup lama).
 */

/** Popup hanya untuk pesanan yang dibuat maksimal 3 menit lalu (anti bising saat reload) */
const FRESH_WINDOW_MS = 3 * 60 * 1000;

function isAdmin(role: string) {
  return role === "ADMIN" || role === "OWNER";
}

/* ================= ADMIN: POPUP PESANAN BARU MASUK ================= */

export function AdminNewOrderWatcher({ user }: { user: AppUser }) {
  const showNotice = useNoticeStore((s) => s.show);
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

        // 🔔 SUARA KHAS AGSI — nyaring
        playAgsiOrder();

        // Daftar dari server urut terbaru dulu → fresh[0] = paling baru
        const t = fresh[0];
        const ringkas = t.items.map((i) => `${i.name} ×${i.qty}`).join(" • ");
        showNotice({
          type: "success",
          mascot: true,
          autoCloseMs: 9000,
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
        });
      } catch {
        // offline — coba lagi di tick berikutnya
      }
    };

    void tick();
    const iv = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [admin, showNotice, go]);

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
  const showNotice = useNoticeStore((s) => s.show);
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

              playAgsiStatus();
              const n = statusNotif(changes[0]);
              showNotice({
                ...n,
                autoCloseMs: 8000,
                actions: [{ label: "Lihat Pesanan", onClick: () => go("orders") }, { label: "Tutup" }],
              });
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
    const iv = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [customer, showNotice, go]);

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
  const showNotice = useNoticeStore((s) => s.show);
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
          playAgsiChat();
          if (staff) {
            showNotice({
              type: "info",
              autoCloseMs: 8000,
              title: "💬 Chat Pelanggan Baru!",
              message:
                unread > 1
                  ? `${unread} pesan pelanggan menunggumu di daftar chat CS.`
                  : "Seorang pelanggan baru mengirim pesan — segera dibalas ya!",
              actions: [
                { label: "Buka Chat", onClick: () => useUiStore.getState().openChat() },
                { label: "Nanti" },
              ],
            });
          } else {
            showNotice({
              type: "info",
              autoCloseMs: 8000,
              title: "💬 Pesan Baru dari CS",
              message:
                unread > 1
                  ? `${unread} balasan baru dari CS AGSI menunggumu di chat.`
                  : "CS AGSI membalas pesanmu — cek sekarang ya!",
              actions: [
                { label: "Buka Chat", onClick: () => useUiStore.getState().openChat() },
                { label: "Nanti" },
              ],
            });
          }
        }
        prevUnread = unread;
      } catch {
        // offline — coba lagi nanti
      }
    };

    void tick();
    const iv = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [enabled, staff, showNotice]);

  return null;
}

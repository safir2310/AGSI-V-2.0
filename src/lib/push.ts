import { db } from "@/lib/db";
import { fcmSend, isFcmConfigured, type FcmMessage } from "@/lib/fcm";
import { formatIDR } from "@/lib/types";

/**
 * LAYANAN PUSH NOTIFIKASI AGSI (FCM) — satu pintu untuk semua pengiriman.
 *
 * Target perangkat: token di tabel PushToken (Chrome Android / aplikasi
 * Android native). Semua pesan dibangun dengan prioritas TINGGI di kedua
 * platform agar tampil sebagai HEADS-UP (banner melayang di atas layar):
 *   - Android : android.priority "HIGH" + channel "agsi_orders" (IMPORTANCE_HIGH)
 *   - Web     : webpush.headers.Urgency "high" (Chrome Android heads-up)
 *
 * Semua helper notify* aman dipakai fire-and-forget (`void notify...()`):
 * tidak pernah melempar, kegagalan hanya dicatat di log server.
 */

/** ID channel Android — WAJIB sama dengan di aplikasi native (android/…) */
export const ANDROID_CHANNEL_ID = "agsi_orders";

/** Channel khusus chat CS — aplikasi native membuat channel "agsi_chat" */
export const ANDROID_CHAT_CHANNEL_ID = "agsi_chat";

export type PushKind = "new_order" | "order_paid" | "order_status" | "chat" | "test";

export type PushPayload = {
  kind: PushKind;
  title: string;
  body: string;
  /** path tujuan saat notifikasi diketuk (relatif, mis. "/orders") */
  url?: string;
  orderId?: string;
  /** tag notifikasi — pesanan sama saling mengganti, bukan menumpuk */
  tag?: string;
};

/** Susun pesan FCM lengkap untuk satu token */
function buildMessage(p: PushPayload, token: string): FcmMessage {
  const data: Record<string, string> = {
    kind: p.kind,
    title: p.title,
    body: p.body,
    url: p.url ?? "/",
    tag: p.tag ?? "agsi",
  };
  if (p.orderId) data.orderId = p.orderId;
  return {
    token,
    notification: { title: p.title, body: p.body },
    data,
    android: {
      priority: "HIGH",
      ttl: "3600s",
      notification: {
        // chat tampil di channel "Chat CS" terpisah agar bisa diatur sendiri
        channel_id: p.kind === "chat" ? ANDROID_CHAT_CHANNEL_ID : ANDROID_CHANNEL_ID,
        sound: "default",
        tag: p.tag ?? "agsi",
        // click_action default → launcher activity; URL dibaca aplikasi dari data.url
      },
    },
    webpush: {
      headers: { Urgency: "high", TTL: "86400" },
    },
  };
}

export type SendReport = {
  configured: boolean;
  total: number;
  sent: number;
  failed: number;
  /** token mati yang otomatis dihapus dari database */
  pruned: number;
};

/** Kirim payload ke daftar token + hapus token mati otomatis */
async function sendToTokens(tokens: string[], p: PushPayload): Promise<SendReport> {
  const configured = isFcmConfigured();
  const report: SendReport = { configured, total: tokens.length, sent: 0, failed: 0, pruned: 0 };
  if (tokens.length === 0 || !configured) return report;

  const dead: string[] = [];
  const CHUNK = 20; // paralel ramah — aplikasi restoran, token puluhan bukan ribuan
  for (let i = 0; i < tokens.length; i += CHUNK) {
    const chunk = tokens.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (t) => ({ token: t, result: await fcmSend(buildMessage(p, t)) }))
    );
    for (const { token, result } of results) {
      if (result.ok) report.sent++;
      else {
        report.failed++;
        if (result.unregistered) dead.push(token);
      }
    }
  }
  if (dead.length > 0) {
    try {
      await db.pushToken.deleteMany({ where: { token: { in: dead } } });
      report.pruned = dead.length;
    } catch {
      // penghapusan gagal — biarkan; akan dicoba lagi pada pengiriman berikutnya
    }
  }
  return report;
}

async function tokensOfRoles(roles: string[]): Promise<string[]> {
  const rows = await db.pushToken.findMany({
    where: { role: { in: roles } },
    select: { token: true },
  });
  return rows.map((r) => r.token);
}

async function tokensOfUser(userId: string): Promise<string[]> {
  const rows = await db.pushToken.findMany({
    where: { userId },
    select: { token: true },
  });
  return rows.map((r) => r.token);
}

/* ================= HELPER BISNIS ================= */

const STAFF_ROLES = ["ADMIN", "OWNER", "CASHIER"];
const CS_ROLES = ["ADMIN", "OWNER"];

function ringkasItems(items: Array<{ name: string; qty: number }>): string {
  const s = items.map((i) => `${i.name} ×${i.qty}`).join(" • ");
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

function ringkasIsi(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
}

/**
 * 🔔 Pesanan baru masuk → push ke SEMUA perangkat staff (admin/owner/kasir).
 * Pesanan QRIS aplikasi yang BELUM dibayar sengaja dilewati (sama dengan
 * aturan daftar pesanan: pesanan baru "masuk" setelah dana terverifikasi —
 * pemantiknya notifyOrderPaid).
 */
export async function notifyNewOrder(orderId: string): Promise<void> {
  try {
    const o = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!o) return;
    if (o.source === "APP" && o.paymentMethod === "QRIS" && o.paymentStatus === "UNPAID") return;

    const lokasi = o.tableNo ? ` • Meja ${o.tableNo}` : o.type === "TAKEAWAY" ? " • Bungkus" : o.type === "DELIVERY" ? " • Antar" : "";
    const payload: PushPayload = {
      kind: "new_order",
      title: "🔔 Pesanan Baru Masuk!",
      body: `${o.code}${lokasi} • ${formatIDR(o.total)}\n${ringkasItems(o.items)}`,
      url: "/orders",
      orderId: o.id,
      tag: `order-${o.id}`,
    };
    await sendToTokens(await tokensOfRoles(STAFF_ROLES), payload);
  } catch (err) {
    console.error("[push] notifyNewOrder gagal:", err);
  }
}

/**
 * 💰 Dana QRIS terverifikasi masuk → kabari staff (masuk dapur) & pelanggan
 * (pembayaran diterima). Satu-satunya pemantik pesanan QRIS aplikasi.
 */
export async function notifyOrderPaid(orderId: string): Promise<void> {
  try {
    const o = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!o) return;
    const ringkas = ringkasItems(o.items);

    await sendToTokens(await tokensOfRoles(STAFF_ROLES), {
      kind: "order_paid",
      title: "💰 QRIS Terbayar — Masuk Dapur!",
      body: `${o.code} • ${formatIDR(o.total)}\n${ringkas}`,
      url: "/orders",
      orderId: o.id,
      tag: `order-${o.id}`,
    });

    if (o.userId) {
      await sendToTokens(await tokensOfUser(o.userId), {
        kind: "order_paid",
        title: "💳 Pembayaran Diterima!",
        body: `Dana pesanan ${o.code} sudah masuk. Pesanan otomatis lanjut ke dapur — pantau di menu Pesanan ya!`,
        url: "/orders",
        orderId: o.id,
        tag: `order-${o.id}`,
      });
    }
  } catch (err) {
    console.error("[push] notifyOrderPaid gagal:", err);
  }
}

/**
 * 👨‍🍳 Perubahan status pesanan → push ke pelanggan pemilik pesanan.
 * (PREPARING / READY / COMPLETED / CANCELLED)
 */
export async function notifyOrderStatus(orderId: string, status: string): Promise<void> {
  try {
    const o = await db.order.findUnique({ where: { id: orderId } });
    if (!o || !o.userId) return;

    const copy: Record<string, { title: string; body: string }> = {
      PREPARING: {
        title: "👨‍🍳 Pesanan Sedang Dimasak",
        body: `Pesanannya ${o.code} sedang digeprek chef! Sambal ijo disiapkan segar ya 🌶️`,
      },
      READY: {
        title: "🔔 Pesanan Siap!",
        body: `${o.code} sudah SIAP${o.type === "DELIVERY" ? " — kurir segera mengantar." : o.type === "TAKEAWAY" ? " — silakan diambil di kasir." : " — silakan dinikmati di mejamu."} Selamat makan!`,
      },
      COMPLETED: {
        title: "🎉 Pesanan Selesai",
        body: `Pesanan ${o.code} selesai. Terima kasih sudah makan di AGSI — poin member juga sudah masuk!`,
      },
      CANCELLED: {
        title: "Pesanan Dibatalkan",
        body: `Pesanan ${o.code} dibatalkan. Bila merasa keliru, hubungi CS lewat menu Chat ya.`,
      },
    };
    const c = copy[status];
    if (!c) return;

    await sendToTokens(await tokensOfUser(o.userId), {
      kind: "order_status",
      title: c.title,
      body: c.body,
      url: "/orders",
      orderId: o.id,
      tag: `order-${o.id}`,
    });
  } catch (err) {
    console.error("[push] notifyOrderStatus gagal:", err);
  }
}

/**
 * 💬 Chat CS — push ke pihak lawan bicara:
 *   - pelanggan/kasir kirim pesan → admin & owner (petugas CS)
 *   - admin/owner membalas → pelanggan pemilik utas
 */
export async function notifyChatMessage(opts: {
  fromRole: string;
  /** utas lawan bicara (wajib bila pengirim admin/owner) */
  toUserId?: string | null;
  senderName: string;
  body: string;
}): Promise<void> {
  try {
    const isStaff = opts.fromRole === "ADMIN" || opts.fromRole === "OWNER";
    const payload: PushPayload = isStaff
      ? {
          kind: "chat",
          title: "💬 Pesan Baru dari CS",
          body: ringkasIsi(opts.body),
          url: "/",
          tag: "chat",
        }
      : {
          kind: "chat",
          title: "💬 Chat Pelanggan Baru",
          body: `${opts.senderName}: ${ringkasIsi(opts.body)}`,
          url: "/",
          tag: "chat",
        };

    if (isStaff) {
      if (!opts.toUserId) return;
      await sendToTokens(await tokensOfUser(opts.toUserId), payload);
    } else {
      await sendToTokens(await tokensOfRoles(CS_ROLES), payload);
    }
  } catch (err) {
    console.error("[push] notifyChatMessage gagal:", err);
  }
}

/**
 * 🧪 Kirim notifikasi uji. scope: self (perangkat sendiri) | staff | customers | all.
 * Dipakai tombol "Kirim Uji" di Profil & broadcast admin.
 */
export async function sendTestPush(opts: {
  scope: "self" | "staff" | "customers" | "all";
  userId?: string;
  title?: string;
  body?: string;
}): Promise<SendReport> {
  const tokens = await (async () => {
    if (opts.scope === "self") return opts.userId ? tokensOfUser(opts.userId) : [];
    if (opts.scope === "staff") return tokensOfRoles(STAFF_ROLES);
    if (opts.scope === "customers") return tokensOfRoles(["CUSTOMER"]);
    const rows = await db.pushToken.findMany({ select: { token: true } });
    return rows.map((r) => r.token);
  })();
  return sendToTokens(tokens, {
    kind: "test",
    title: opts.title ?? "🍗 Notifikasi Uji AGSI",
    body:
      opts.body ??
      "Heads-up push berjalan! Pesanan & chat akan muncul seperti ini walau aplikasi sedang tertutup.",
    url: "/",
    tag: "test",
  });
}

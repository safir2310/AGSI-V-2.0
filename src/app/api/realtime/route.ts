import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { HIDDEN_UNPAID_DIGITAL_WHERE } from "@/lib/order-expiry";

export const dynamic = "force-dynamic";
// SSE berjalan ±48 detik per koneksi (di bawah batas paket Vercel apa pun)
// lalu ditutup — EventSource di klien tersambung ulang OTOMATIS dan menerima
// snapshot awal, sehingga perubahan yang terjadi selama jeda tidak pernah
// terlewat (konsistensi akhir selalu terjamin).
export const maxDuration = 60;

/**
 * GET /api/realtime — PUSAT SINKRONISASI REAL-TIME (Server-Sent Events).
 *
 * Satu koneksi terus-menerus per perangkat. Server membandingkan "revisi"
 * data (pesananan: id+status+pembayaran; chat: jumlah belum dibaca+waktu
 * utas terakhir) tiap ±1,5 detik dan SEGERA mengirim event saat berubah:
 *
 *   event: orders  → pesanan baru / pembayaran QRIS masuk / status berubah
 *                    → klien segarkan daftar & jalankan tick notifikasi
 *   event: chat    → pesan chat baru (badge + sheet chat menarik instan)
 *   : ping         → detak jaga agar koneksi tidak dibunuh perantara
 *
 * Auth lewat cookie sesi web (sama dengan API lain). Bila sesi habis di
 * tengah arus → event "bye" lalu aliran ditutup.
 */

const TICK_MS = 1_500;
const HEARTBEAT_MS = 15_000;
const LIFETIME_MS = 48_000;
/** Cek ulang sesi tiap N putaran (≈10 × 1,5 dtk = 15 detik) */
const REVALIDATE_EVERY = 10;

type RtUser = { id: string; role: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Revisi pesanan untuk peran ini: berubah bila ada pesanan baru, status
 *  atau status pembayaran berubah (admin/kasir = semua, pelanggan = miliknya). */
async function ordersRevision(user: RtUser): Promise<string> {
  const where =
    isAdminRole(user.role) || user.role === "CASHIER"
      ? { NOT: HIDDEN_UNPAID_DIGITAL_WHERE }
      : { userId: user.id };
  const rows = await db.order.findMany({
    where,
    select: { id: true, status: true, paymentStatus: true },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return rows.map((r) => `${r.id}:${r.status}:${r.paymentStatus}`).join("|");
}

/** Revisi chat: (jumlah belum dibaca, waktu utas terakhir berubah) —
 *  admin = agregat semua utas pelanggan, lainnya = utas sendiri. */
async function chatRevision(user: RtUser): Promise<{ rev: string; unread: number }> {
  if (isAdminRole(user.role)) {
    const [sum, max] = await Promise.all([
      db.chatThread.aggregate({ _sum: { unreadAdmin: true } }),
      db.chatThread.aggregate({ _max: { updatedAt: true } }),
    ]);
    const unread = sum._sum.unreadAdmin ?? 0;
    return { rev: `${unread}@${max._max.updatedAt?.getTime() ?? 0}`, unread };
  }
  const own = await db.chatThread.findUnique({
    where: { userId: user.id },
    select: { unreadCustomer: true, updatedAt: true },
  });
  const unread = own?.unreadCustomer ?? 0;
  return { rev: `${unread}@${own?.updatedAt.getTime() ?? 0}`, unread };
}

/** Revisi pengaturan (AGSI Motion Studio publish/restore/reset dkk): waktu
 *  ubah baris StoreSetting — 1 query skalar ringan, hanya tiap 4 tick
 *  (±6 dtk) agar murah; event hanya dikirim saat versi benar-benar naik
 *  (tanpa polling tambahan di sisi klien). */
async function settingsRevision(): Promise<string> {
  const row = await db.storeSetting.findUnique({
    where: { id: "main" },
    select: { updatedAt: true },
  });
  return row?.updatedAt.getTime().toString() ?? "";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };
      const ping = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      };

      const startedAt = Date.now();
      let prevOrders = "";
      let prevChat = "";
      let prevSettings = "";
      let ticks = 0;

      // Satu putaran snapshot: bandingkan revisi → kirim event bila berubah.
      // initial=true → kirim keduanya sekali (sinkronisasi awal / seusai reconnect).
      const step = async (initial: boolean) => {
        let ordersRev = "";
        let chat: { rev: string; unread: number } = { rev: "", unread: 0 };
        try {
          ordersRev = await ordersRevision(user);
        } catch {
          // DB sedang sibuk → putaran ini dilewati, koneksi tetap hidup
        }
        try {
          chat = await chatRevision(user);
        } catch {
          // idem
        }
        if (initial || (ordersRev !== "" && ordersRev !== prevOrders)) {
          prevOrders = ordersRev;
          send("orders", { t: Date.now() });
        }
        if (initial || (chat.rev !== "" && chat.rev !== prevChat)) {
          prevChat = chat.rev;
          send("chat", { unread: chat.unread, t: Date.now() });
        }
        // Pengaturan (motion studio) — ukur tiap 4 tick, kirim HANYA bila
        // berubah selama koneksi (snapshot awal tidak memicu reload ganda).
        if (!initial && ticks % 4 === 0) {
          try {
            const s = await settingsRevision();
            if (s && prevSettings && s !== prevSettings) send("settings", { t: Date.now() });
            if (s) prevSettings = s;
          } catch {
            // idem
          }
        }
      };

      // Snapshot AWAL — klien langsung segarkan data saat tersambung/tersambung ulang.
      await step(true);

      const heartbeat = setInterval(ping, HEARTBEAT_MS);
      try {
        while (!closed && Date.now() - startedAt < LIFETIME_MS) {
          await sleep(TICK_MS);
          ticks++;
          // Sesi masih sah? (murah — 1 lookups sesi tiap ±15 detik)
          if (ticks % REVALIDATE_EVERY === 0) {
            const u = await getCurrentUser();
            if (!u || u.id !== user.id) {
              send("bye", {});
              break;
            }
          }
          await step(false);
        }
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // aliran sudah tertutup dari sisi klien
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Buffering proxy mati — event terkirim begitu dibuat
      "X-Accel-Buffering": "no",
    },
  });
}

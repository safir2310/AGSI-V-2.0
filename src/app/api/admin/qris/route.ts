import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { cancelExpiredQrisOrders } from "@/lib/order-expiry";
import { notifyOrderStatus } from "@/lib/push";
import {
  DANA_ENABLED,
  DANA_IS_PRODUCTION,
  MIDTRANS_ENABLED,
  MIDTRANS_IS_PRODUCTION,
  QRIS_SANDBOX_ENABLED,
} from "@/lib/qris-config";
import { cancelQrisDanaPayment } from "@/lib/qris-dana";
import { cancelQrisMidtransPayment } from "@/lib/qris-midtrans";
import { QrisGatewayError } from "@/lib/qris-provider";

/**
 * GET /api/admin/qris — PENGELOLA QRIS (khusus Admin/Owner)
 *
 * Satu panggilan untuk seluruh halaman "Pengelola QRIS" di Profil Admin:
 *   - config       : status penyedia QRIS aktif (Midtrans produksi/sandbox,
 *                    gateway bawaan) — tanpa probe jaringan agar cepat.
 *   - summary      : ringkasan DANA MASUK QRIS (total, hari ini, jumlah
 *                    lunas / menunggu / batal, rata-rata, tingkat sukses).
 *   - daily        : dana masuk 7 hari terakhir (untuk grafik mini).
 *   - transactions : daftar transaksi QRIS 90 hari terakhir — tanggal
 *                    transaksi, jumlah dana, status, penyedia, jejak
 *                    pelunasan (paidAt/paidVia) & alasan fallback.
 *
 * "Dana masuk" dihitung HANYA dari pesanan QRIS yang benar-benar dilunaskan
 * sistem (paymentStatus PAID — uang terverifikasi di penyedia).
 *
 * POST /api/admin/qris — batalkan transaksi QRIS yang masih MENUNGGU BAYAR
 * (body: { orderId }). Transaksi ikut dibatalkan di penyedia (Midtrans
 * /v2/{id}/cancel atau gateway bawaan) supaya QR tidak bisa dibayar lagi;
 * voucher yang tertaut dikembalikan ke pelanggan.
 */

/** Jangkauan data daftar transaksi (hari) & batas jumlah baris */
const RANGE_DAYS = 90;
const MAX_ROWS = 300;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Sapu dulu pesanan QRIS kedaluwarsa agar status daftar selalu segar
  try {
    await cancelExpiredQrisOrders();
  } catch {
    // sweep gagal -> data tetap ditampilkan
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeStart = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000); // 7 hari (hari ini + 6)

  const qrisOrders = await db.order.findMany({
    where: {
      paymentMethod: "QRIS",
      createdAt: { gte: new Date(now.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      code: true,
      customerName: true,
      type: true,
      source: true,
      status: true,
      paymentStatus: true,
      total: true,
      qrisTrxId: true,
      qrisMode: true,
      qrisProvider: true,
      qrisFallbackReason: true,
      qrisExpiresAt: true,
      paidAt: true,
      paidVia: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  // ===== Ringkasan dana masuk =====
  const paid = qrisOrders.filter((o) => o.paymentStatus === "PAID");
  const pending = qrisOrders.filter(
    (o) => o.paymentStatus === "UNPAID" && o.status === "PENDING"
  );
  const failed = qrisOrders.filter(
    (o) => o.paymentStatus === "UNPAID" && o.status !== "PENDING"
  );

  const totalMasuk = paid.reduce((s, o) => s + o.total, 0);
  const masukHariIni = paid
    .filter((o) => o.paidAt && new Date(o.paidAt) >= startOfToday)
    .reduce((s, o) => s + o.total, 0);
  const settled = paid.length + failed.length; // transaksi yang sudah punya hasil akhir

  // ===== Dana masuk 7 hari terakhir (berdasarkan paidAt — kapan uang benar-benar masuk) =====
  const daily: Array<{ date: string; label: string; amount: number; count: number }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000);
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    const dayPaid = paid.filter((o) => {
      const t = o.paidAt ? new Date(o.paidAt) : null;
      return t !== null && t >= d && t < next;
    });
    daily.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }),
      amount: dayPaid.reduce((s, o) => s + o.total, 0),
      count: dayPaid.length,
    });
  }

  return NextResponse.json({
    config: {
      dana: { enabled: DANA_ENABLED, production: DANA_IS_PRODUCTION },
      midtrans: { enabled: MIDTRANS_ENABLED, production: MIDTRANS_IS_PRODUCTION },
      internal: { sandboxEnabled: QRIS_SANDBOX_ENABLED },
      activeProvider: DANA_ENABLED
        ? "dana"
        : MIDTRANS_ENABLED
          ? "midtrans"
          : QRIS_SANDBOX_ENABLED
            ? "internal"
            : "external",
    },
    summary: {
      totalMasuk,
      masukHariIni,
      countLunas: paid.length,
      countMenunggu: pending.length,
      countGagal: failed.length,
      countSemua: qrisOrders.length,
      avgMasuk: paid.length > 0 ? Math.round(totalMasuk / paid.length) : 0,
      successRate: settled > 0 ? Math.round((paid.length / settled) * 100) : 0,
    },
    daily,
    transactions: qrisOrders.map((o) => ({
      id: o.id,
      code: o.code,
      customerName: o.customerName,
      type: o.type,
      source: o.source,
      status: o.status,
      paymentStatus: o.paymentStatus,
      total: o.total,
      provider: o.qrisProvider,
      qrisTrxId: o.qrisTrxId,
      qrisMode: o.qrisMode,
      qrisFallbackReason: o.qrisFallbackReason,
      qrisExpiresAt: o.qrisExpiresAt,
      paidAt: o.paidAt,
      paidVia: o.paidVia,
      createdAt: o.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { orderId?: unknown };
  try {
    body = (await req.json()) as { orderId?: unknown };
  } catch {
    return NextResponse.json({ error: "Body bukan JSON." }, { status: 400 });
  }
  const orderId = typeof body.orderId === "string" ? body.orderId : null;
  if (!orderId) {
    return NextResponse.json({ error: "orderId wajib diisi." }, { status: 400 });
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  if (order.paymentMethod !== "QRIS") {
    return NextResponse.json({ error: "Bukan pesanan QRIS." }, { status: 400 });
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json(
      { error: "Transaksi sudah LUNAS — dana sudah masuk dan tidak bisa dibatalkan." },
      { status: 409 }
    );
  }
  if (order.status !== "PENDING") {
    return NextResponse.json(
      { error: `Pesanan berstatus ${order.status} dan tidak bisa dibatalkan dari sini.` },
      { status: 400 }
    );
  }

  // ===== 1) Batalkan transaksi di PENYEDIA supaya QR tidak bisa dibayar lagi =====
  let providerNote: string | null = null;
  try {
    if (order.qrisProvider === "dana" && order.qrisTrxId && DANA_ENABLED) {
      const r = await cancelQrisDanaPayment(order.qrisTrxId);
      if (r.alreadyPaid) {
        // Dana ternyata baru masuk di DANA — JANGAN batalkan; biarkan
        // polling/webhook melunaskan pesanan otomatis.
        return NextResponse.json(
          {
            error:
              "Dana baru saja terdeteksi masuk di DANA. Pembatalan dibatalkan — pesanan akan dilunaskan otomatis oleh sistem.",
          },
          { status: 409 }
        );
      }
      providerNote = r.providerStatus;
    } else if (order.qrisProvider === "midtrans" && order.qrisTrxId && MIDTRANS_ENABLED) {
      const r = await cancelQrisMidtransPayment(order.qrisTrxId);
      if (r.alreadyPaid) {
        // Dana ternyata baru masuk di Midtrans — JANGAN batalkan; biarkan
        // polling/webhook melunaskan pesanan otomatis.
        return NextResponse.json(
          {
            error:
              "Dana baru saja terdeteksi masuk di Midtrans. Pembatalan dibatalkan — pesanan akan dilunaskan otomatis oleh sistem.",
          },
          { status: 409 }
        );
      }
      providerNote = r.providerStatus;
    } else if (order.qrisTrxId) {
      // Gateway bawaan: matikan transaksi sandbox terkait
      await db.qrisSandboxTrx.updateMany({
        where: { trxid: order.qrisTrxId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      providerNote = "internal_cancelled";
    }
  } catch (err) {
    const msg =
      err instanceof QrisGatewayError
        ? err.message
        : "Tidak dapat menghubungi penyedia QRIS untuk membatalkan transaksi.";
    return NextResponse.json(
      { error: `Batal di penyedia gagal: ${msg}` },
      { status: 502 }
    );
  }

  // ===== 2) Batalkan pesanan lokal + kembalikan voucher (idempoten) =====
  await db.$transaction(async (tx) => {
    const cur = await tx.order.findUnique({
      where: { id: order.id },
      select: { id: true, paymentStatus: true, status: true, voucherCode: true },
    });
    // Berubah di tengah jalan (dana masuk bersamaan) -> jangan sentuh
    if (!cur || cur.paymentStatus === "PAID" || cur.status !== "PENDING") return;

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });

    if (cur.voucherCode) {
      const redemption = await tx.voucherRedemption.findUnique({
        where: { orderId: order.id },
      });
      if (redemption) {
        await tx.voucherRedemption.delete({ where: { id: redemption.id } });
        await tx.voucher.update({
          where: { id: redemption.voucherId },
          data: { usedCount: { decrement: 1 } },
        });
      }
    }
  });

  // 🔔 Kabari perangkat pelanggan (pola yang sama dengan pembatalan lain)
  void notifyOrderStatus(order.id, "CANCELLED");

  return NextResponse.json({
    ok: true,
    providerStatus: providerNote,
    message:
      "Transaksi QRIS dibatalkan — QR sudah dimatikan di penyedia dan tidak bisa dibayar lagi.",
  });
}

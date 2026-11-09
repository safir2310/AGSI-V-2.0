import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { buildQrisPayload, QRIS_MERCHANT_ID, QRIS_MERCHANT_NAME } from "@/lib/qris";
import {
  createQrisGatewayPayment,
  QRIS_SANDBOX_ENABLED,
} from "@/lib/qris-gateway";
import {
  CASAKU_ENABLED,
  DANA_ENABLED,
  DANA_IS_PRODUCTION,
  DOKU_ENABLED,
  DOKU_IS_PRODUCTION,
  MIDTRANS_ENABLED,
  MIDTRANS_IS_PRODUCTION,
} from "@/lib/qris-config";
import { cancelQrisOrderIfExpired, QRIS_PAYMENT_TIMEOUT_MS } from "@/lib/order-expiry";

/** Penyedia aktif — untuk label layar pembayaran */
const PROVIDER = DOKU_ENABLED
  ? DOKU_IS_PRODUCTION
    ? "doku"
    : "doku-sandbox"
  : DANA_ENABLED
  ? DANA_IS_PRODUCTION
    ? "dana"
    : "dana-sandbox"
  : CASAKU_ENABLED
    ? "casaku"
    : MIDTRANS_ENABLED
      ? MIDTRANS_IS_PRODUCTION
        ? "midtrans"
        : "midtrans-sandbox"
      : "internal";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/orders/[id]/qris
 * Kode bayar QRIS untuk sebuah pesanan.
 *
 * Utama: buat transaksi QRIS DINAMIS di penyedia gateway (verifikasi otomatis
 * aktif — sistem akan melunaskan pesanan saat dana masuk).
 * Fallback: bila gateway error/tidak aktif, kode QRIS lokal tetap ditampilkan
 * (mode LOCAL, autoVerify false) supaya pelanggan tetap bisa melihat kodenya.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  const order = await db.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  const allowed =
    isAdminRole(user.role) || user.role === "CASHIER" || order.userId === user.id;
  if (!allowed) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  if (order.paymentMethod !== "QRIS") {
    return NextResponse.json(
      { error: "Pesanan ini menggunakan pembayaran tunai." },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "PAID") {
    // Sudah lunas — layar pembayaran cukup menampilkan sukses
    return NextResponse.json({
      paid: true,
      amount: order.total,
      orderCode: order.code,
    });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json(
      {
        error: "Pesanan ini sudah dibatalkan.",
        cancelled: true,
      },
      { status: 400 }
    );
  }

  // Lewat batas 5 menit & belum dibayar -> batal otomatis, jangan buat kode baru
  const expired = await cancelQrisOrderIfExpired(order);
  if (expired.cancelled) {
    return NextResponse.json(
      {
        error:
          "Waktu pembayaran habis — pesanan dibatalkan otomatis. Silakan buat pesanan baru.",
        cancelled: true,
      },
      { status: 400 }
    );
  }

  // Batas waktu pesanan (dibuat + 5 menit) untuk hitung mundur di layar
  const cancelAt = new Date(order.createdAt.getTime() + QRIS_PAYMENT_TIMEOUT_MS).toISOString();

  if (order.total <= 0) {
    return NextResponse.json(
      { error: "Total pesanan nol — tidak perlu QRIS." },
      { status: 400 }
    );
  }

  const base = {
    amount: order.total,
    merchantName: QRIS_MERCHANT_NAME,
    merchantId: QRIS_MERCHANT_ID,
    orderCode: order.code,
  };

  // ==== 1) Transaksi gateway yang masih hidup -> pakai cache ====
  const gatewayAlive =
    order.qrisTrxId &&
    order.qrisMode === "GATEWAY" &&
    (!order.qrisExpiresAt || order.qrisExpiresAt.getTime() > Date.now());
  if (gatewayAlive && order.qrisPayload) {
    // Provider aktual transaksi tersimpan: kolom qrisProvider (transaksi baru),
    // fallback heuristik prefix "SBX-" = gateway bawaan untuk transaksi lama.
    const cachedProvider =
      order.qrisProvider ??
      (order.qrisTrxId?.startsWith("SBX-") ? "internal" : PROVIDER);
    // Nominal final yang harus dibayar (total + kode unik Casaku bila ada)
    const payAmount = order.qrisAmount ?? order.total;
    const uniqueCode = payAmount > order.total ? payAmount - order.total : null;
    return NextResponse.json({
      ...base,
      amount: payAmount,
      ...(uniqueCode !== null ? { uniqueCode } : {}),
      payload: order.qrisPayload,
      mode: "GATEWAY",
      autoVerify: true,
      // tombol simulasi dana masuk hanya untuk gateway bawaan (sandbox lokal)
      sandbox: cachedProvider === "internal" && QRIS_SANDBOX_ENABLED,
      provider: cachedProvider,
      // Alasan penyedia utama ditolak (jejak transparansi fallback)
      ...(order.qrisFallbackReason ? { fallbackReason: order.qrisFallbackReason } : {}),
      // Sandbox Midtrans: QR berisi tautan simulator uji pembayaran —
      // ditampilkan layar pembayaran agar pengujian tanpa dompet nyata bisa jalan.
      sandboxSimulatorUrl:
        cachedProvider === "midtrans-sandbox" && order.qrisPayload.startsWith("http")
          ? order.qrisPayload
          : undefined,
      trxId: order.qrisTrxId,
      expiresAt: order.qrisExpiresAt?.toISOString() ?? null,
      cancelAt,
    });
  }

  // ==== 2) Buat transaksi baru di penyedia gateway ====
  try {
    const trx = await createQrisGatewayPayment({
      amount: order.total,
      reference: order.code,
    });
    const payload = trx.qrString ?? null;
    // Casaku (kode unik aktif): nominal final = total + kode unik — pelanggan
    // wajib membayar nominal PERSIS ini agar verifikasi cocok.
    const payAmount = trx.finalAmount ?? order.total;
    const uniqueCode = payAmount > order.total ? payAmount - order.total : null;
    await db.order.update({
      where: { id: order.id },
      data: {
        qrisTrxId: trx.trxId,
        qrisPayload: payload,
        qrisMode: "GATEWAY",
        qrisExpiresAt: trx.expiresAt ? new Date(trx.expiresAt) : null,
        qrisAmount: payAmount,
        // Jejak penyedia aktual + alasan fallback (transparansi layar bayar)
        qrisProvider: trx.provider ?? null,
        qrisFallbackReason: trx.fallbackReason ?? null,
      },
    });
    const trxProvider =
      trx.provider === "midtrans"
        ? PROVIDER // "midtrans" | "midtrans-sandbox" untuk UI
        : trx.provider ?? "internal";
    return NextResponse.json({
      ...base,
      amount: payAmount,
      ...(uniqueCode !== null ? { uniqueCode } : {}),
      payload,
      imageUrl: trx.imageUrl ?? undefined,
      mode: "GATEWAY",
      autoVerify: true,
      sandbox: trxProvider === "internal" && QRIS_SANDBOX_ENABLED,
      provider: trxProvider,
      sandboxSimulatorUrl:
        trxProvider === "midtrans-sandbox" && payload !== null && payload.startsWith("http")
          ? payload
          : undefined,
      ...(trx.fallbackReason ? { fallbackReason: trx.fallbackReason } : {}),
      trxId: trx.trxId,
      expiresAt: trx.expiresAt ?? null,
      cancelAt,
    });
  } catch (err) {
    // ==== 3) Gateway tidak aktif -> fallback kode lokal (tanpa verifikasi otomatis) ====
    const gatewayError =
      err instanceof Error ? err.message : "Penyedia QRIS tidak dapat dihubungi.";
    try {
      const payload = buildQrisPayload({ amount: order.total, reference: order.code });
      await db.order.update({
        where: { id: order.id },
        data: {
          qrisPayload: payload,
          qrisMode: "LOCAL",
          qrisExpiresAt: null,
          qrisAmount: null,
          qrisProvider: null,
          qrisFallbackReason: null,
        },
      });
      return NextResponse.json({
        ...base,
        payload,
        mode: "LOCAL",
        autoVerify: false,
        gatewayError,
        cancelAt,
      });
    } catch {
      return NextResponse.json({ error: "Gagal membuat kode QRIS." }, { status: 500 });
    }
  }
}

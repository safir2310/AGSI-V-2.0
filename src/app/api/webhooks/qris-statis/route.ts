import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { markOrderPaidBySystem, normalizeGatewayStatus } from "@/lib/qris-gateway";
import { QRIS_STATIS_WEBHOOK_SECRET } from "@/lib/qris-statis";

/**
 * POST /api/webhooks/qris-statis
 *
 * Pintu masuk NOTIFIKASI DANA untuk QRIS STATIS TOKO (tanpa sesi login —
 * dipanggil mesin layanan mutasi, bukan manusia).
 *
 * QRIS statis toko tidak mengirim callback sendiri, TETAPI bila pemilik
 * toko kelak menyambungkan layanan pemantau mutasi QRIS / dompet (apapun
 * penyedianya), layanan itu cukup memanggil endpoint ini supaya pelunasan
 * jadi OTOMATIS PENUH tanpa mengubah kode aplikasi:
 *
 *   POST {DOMAIN}/api/webhooks/qris-statis
 *   Header: x-webhook-secret: <QRIS_STATIS_WEBHOOK_SECRET>
 *   Body  : { "reference": "AGSI…", "trxid"?: "STS-…", "amount": 27500,
 *             "status": "PAID", "paidAt"?: "2026-…Z" }
 *   (field diterima toleran: reference/orderCode, amount/grossAmount,
 *    status/paymentStatus — PAID/settled/success diterima sebagai lunas)
 *
 * Keamanan:
 *   - Secret WAJIB cocok (bandingkan konstan-waktu). Secret di .env:
 *     QRIS_STATIS_WEBHOOK_SECRET. Tanpa secret terpasang, endpoint ditutup.
 *   - Nominal diverifikasi terhadap pesanan (anti salah tempel).
 *   - Hanya pesanan QRIS berpenyedia "statis" yang bisa dilunaskan di sini.
 *   - Idempoten: pesanan yang sudah lunas cukup dijawab ok.
 */
export async function POST(req: NextRequest) {
  // ===== Autentikasi mesin pengirim (wajib, konstan-waktu) =====
  if (!QRIS_STATIS_WEBHOOK_SECRET) {
    return NextResponse.json(
      { ok: false, reason: "Webhook QRIS statis belum dikonfigurasi (secret kosong)." },
      { status: 403 }
    );
  }
  const got =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-signature") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(QRIS_STATIS_WEBHOOK_SECRET).digest();
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, reason: "Secret tidak cocok." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "Body bukan JSON." }, { status: 400 });
  }

  const data =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : body;

  const reference =
    [data.reference, data.referenceNo, data.orderCode, data.order_code, body.reference, body.orderCode]
      .find((v): v is string => typeof v === "string" && !!v.trim()) ?? null;
  const trxId =
    [data.trxid, data.trxId, data.transactionId, data.transaction_id, body.trxid, body.trxId]
      .find((v): v is string => typeof v === "string" && !!v.trim()) ?? null;
  const amountRaw = [data.amount, data.grossAmount, data.gross_amount, body.amount]
    .map((v) => (typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : Number(v)))
    .find((v) => Number.isFinite(v) && v > 0);
  const status = normalizeGatewayStatus(
    data.status ?? body.status ?? data.paymentStatus ?? body.paymentStatus
  );

  if (status !== "PAID") {
    // pending/expired/cancel — tidak ada dana masuk, cukup diterima
    return NextResponse.json({ ok: true, ignored: true, status });
  }

  // ===== Cari pesanan: trxid gateway, kode pesanan, atau referensi di QR =====
  let order: {
    id: string;
    code: string;
    total: number;
    paymentMethod: string;
    qrisProvider: string | null;
  } | null = null;
  if (trxId) {
    order = await db.order.findFirst({ where: { qrisTrxId: trxId } });
  }
  if (!order && reference) {
    order = await db.order.findFirst({
      where: { code: reference, paymentMethod: "QRIS" },
      orderBy: { createdAt: "desc" },
    });
    if (!order) {
      // Referensi di dalam QR dibersihkan dari tanda baca — cocokkan bentuk itu
      const refAlnum = reference.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (refAlnum && refAlnum !== reference) {
        const candidates = await db.order.findMany({
          where: { paymentMethod: "QRIS", code: { startsWith: refAlnum.slice(0, 8) } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, code: true, total: true, paymentMethod: true, qrisProvider: true },
        });
        order = candidates.find((o) => o.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === refAlnum) ?? null;
      }
    }
  }

  if (!order) {
    return NextResponse.json({ ok: false, reason: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  if (order.paymentMethod !== "QRIS" || order.qrisProvider !== "statis") {
    return NextResponse.json(
      { ok: false, reason: "Pesanan bukan QRIS statis toko." },
      { status: 400 }
    );
  }

  // ===== Nominal harus cocok (mutasi nyata punya nominal persis dari QR) =====
  if (amountRaw != null && Math.round(amountRaw) !== order.total) {
    return NextResponse.json(
      {
        ok: false,
        reason: `Nominal mutasi (${Math.round(amountRaw)}) tidak cocok dengan tagihan pesanan (${order.total}).`,
      },
      { status: 409 }
    );
  }

  // ==== DANA MASUK -> sistem melunaskan (idempoten) ====
  const result = await markOrderPaidBySystem(order.id);
  if (result.cancelled) {
    // Dana masuk SETELAH pesanan dibatalkan otomatis (lewat masa berlaku) —
    // pesanan tidak dihidupkan kembali; dana dikembalikan ke pembayar.
    return NextResponse.json(
      {
        ok: false,
        reason:
          "Pesanan sudah dibatalkan otomatis karena melewati masa berlaku kode QRIS. Dana dikembalikan ke pembayar.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, provider: "statis", orderId: order.id });
}

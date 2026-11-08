import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { markOrderPaidBySystem, normalizeGatewayStatus } from "@/lib/qris-gateway";
import { MIDTRANS_ENABLED } from "@/lib/qris-config";
import { verifyMidtransSignature } from "@/lib/qris-midtrans";

/**
 * POST /api/webhooks/qris
 *
 * Pintu masuk NOTIFIKASI DANA dari penyedia QRIS (tanpa sesi login —
 * dipanggil mesin penyedia, bukan manusia). Ketika penyedia memberi tahu
 * bahwa sebuah transaksi sudah dibayar, SISTEM langsung melunaskan
 * pesanan terkait. Ini jalur verifikasi otomatis kedua (selain polling).
 *
 * MIDTRANS: HTTP Notification dikirim dengan body
 *   { order_id, status_code, gross_amount, signature_key, transaction_status,
 *     transaction_id, fraud_status? } — signature WAJIB diverifikasi
 *   sha512(order_id+status_code+gross_amount+serverKey) sebelum dipercaya.
 *   Tautan webhook produksi: {DOMAIN}/api/webhooks/qris
 *   (dashboard Midtrans ▸ Settings ▸ Configuration ▸ Payment Notification URL).
 *
 * Keamanan penyedia lain (opsional): set env QRIS_WEBHOOK_SECRET, lalu penyedia
 * mengirim header x-webhook-secret yang sama. Tanpa env ini, webhook tetap
 * diterima (mode pengembangan) tetapi hanya transaksi QRIS bersangkutan
 * yang bisa dilunaskan.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "Body bukan JSON." }, { status: 400 });
  }

  // ===== MIDTRANS HTTP NOTIFICATION — verifikasi signature khusus =====
  const signatureKey =
    typeof body.signature_key === "string" ? body.signature_key : null;
  const midOrderId = typeof body.order_id === "string" ? body.order_id : null;
  if (MIDTRANS_ENABLED && signatureKey && midOrderId) {
    const valid = verifyMidtransSignature({
      orderId: midOrderId,
      statusCode: String(body.status_code ?? ""),
      grossAmount: String(body.gross_amount ?? ""),
      signatureKey,
    });
    if (!valid) {
      return NextResponse.json(
        { ok: false, reason: "Signature Midtrans tidak valid." },
        { status: 403 }
      );
    }
    const status = normalizeGatewayStatus(body.transaction_status);
    if (status !== "PAID") {
      // pending / expire / cancel / deny — tidak ada dana masuk, cukup diterima
      return NextResponse.json({ ok: true, provider: "midtrans", ignored: true, status });
    }
    // Cari pesanan: transaction_id Midtrans tersimpan di Order.qrisTrxId;
    // fallback: order_id Midtrans = kode pesanan (mis. "AGSI-20261107-2856")
    // yang bisa + suffix unik "-<ts>" bila transaksi dibuat ulang. Kode
    // pesanan sendiri mengandung "-", jadi kandidat dicoba bertahap.
    const midTrxId =
      typeof body.transaction_id === "string" ? body.transaction_id : null;
    const candidates = new Set<string>();
    const addCandidate = (s: string) => {
      if (!s) return;
      candidates.add(s);
      const noSuffix = s.replace(/-[0-9a-z]+$/i, "");
      if (noSuffix !== s) candidates.add(noSuffix);
    };
    addCandidate(midOrderId);
    addCandidate(midOrderId.replace(/^AGSI-/, ""));
    let order: { id: string; paymentMethod: string } | null = null;
    if (midTrxId) {
      order = await db.order.findFirst({ where: { qrisTrxId: midTrxId } });
    }
    for (const code of candidates) {
      if (order) break;
      order = await db.order.findFirst({
        where: { code, paymentMethod: "QRIS" },
        orderBy: { createdAt: "desc" },
      });
    }
    if (!order) {
      return NextResponse.json({ ok: false, reason: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    if (order.paymentMethod !== "QRIS") {
      return NextResponse.json({ ok: false, reason: "Bukan pesanan QRIS." }, { status: 400 });
    }
    const result = await markOrderPaidBySystem(order.id);
    if (result.cancelled) {
      return NextResponse.json(
        {
          ok: false,
          reason:
            "Pesanan sudah dibatalkan otomatis karena melewati batas waktu pembayaran. Dana dikembalikan ke pembayar.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, provider: "midtrans" });
  }

  // ===== Penyedia lain (gateway bawaan / eksternal) =====
  // Cek shared secret bila dikonfigurasi
  const secret = process.env.QRIS_WEBHOOK_SECRET;
  if (secret) {
    const got =
      req.headers.get("x-webhook-secret") ??
      req.headers.get("x-signature") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (got !== secret) {
      return NextResponse.json({ ok: false, reason: "Secret tidak cocok." }, { status: 401 });
    }
  }

  const data =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : body;

  const trxId =
    [data.trxid, data.trxId, data.transactionId, data.transaction_id, body.trxid, body.trxId]
      .find((v): v is string => typeof v === "string" && !!v.trim()) ?? null;
  const reference =
    [data.reference, data.referenceNo, data.partnerReferenceNo, body.reference]
      .find((v): v is string => typeof v === "string" && !!v.trim()) ?? null;
  const status = normalizeGatewayStatus(data.status ?? body.status ?? data.paymentStatus ?? body.paymentStatus);
  const orderId =
    [data.orderId, data.order_id, body.orderId, body.order_id]
      .find((v): v is string => typeof v === "string" && !!v.trim()) ?? null;

  if (status !== "PAID") {
    // Notifikasi non-pembayaran (pending/expired) -> cukup diterima
    return NextResponse.json({ ok: true, ignored: true, status });
  }

  // Cari pesanan QRIS bersangkutan: pakai orderId langsung, trxId gateway,
  // atau referensi (nomor pesanan) bila penyedia hanya mengirim itu.
  let order = null as null | { id: string; paymentMethod: string; paymentStatus: string };
  if (orderId) {
    order = await db.order.findUnique({ where: { id: orderId } });
  }
  if (!order && trxId) {
    order = await db.order.findFirst({ where: { qrisTrxId: trxId } });
  }
  if (!order && reference) {
    order = await db.order.findFirst({
      where: { code: reference, paymentMethod: "QRIS" },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!order) {
    return NextResponse.json({ ok: false, reason: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  if (order.paymentMethod !== "QRIS") {
    return NextResponse.json({ ok: false, reason: "Bukan pesanan QRIS." }, { status: 400 });
  }

  // ==== DANA MASUK -> sistem melunaskan (idempoten) ====
  const result = await markOrderPaidBySystem(order.id);
  if (result.cancelled) {
    // Dana masuk SETELAH pesanan dibatalkan otomatis (lewat 5 menit) —
    // pesanan tidak dihidupkan kembali; dana dikembalikan penyedia ke pembayar.
    return NextResponse.json(
      {
        ok: false,
        reason:
          "Pesanan sudah dibatalkan otomatis karena melewati batas waktu pembayaran. Dana dikembalikan ke pembayar.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { markOrderPaidBySystem, normalizeGatewayStatus } from "@/lib/qris-gateway";
import {
  DANA_CLIENT_ID,
  DANA_ENABLED,
  DANA_PUBLIC_KEY,
} from "@/lib/qris-config";
import { verifyDanaWebhookSignature } from "@/lib/qris-dana";
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
 * DANA ENTERPRISE (QRIS Acquirer — Finish Notify): DANA memanggil URL ini
 * dengan header X-SIGNATURE (asimetris, ditandatangani DANA dengan private
 * key mereka), X-TIMESTAMP, dan X-PARTNER-ID. Body Finish Notify berisi
 * originalPartnerReferenceNo (= trxId DANA yang tersimpan di Order) dan
 * latestTransactionStatus ("00" = dana masuk). Signature DIVERIFIKASI dengan
 * DANA_PUBLIC_KEY atas stringToSnap "POST:<path>:<sha256(body)>:<ts>"
 * SEBELUM dipercaya (fail-closed — tanpa kunci publik, notifikasi ditolak
 * agar DANA mengulangi pengiriman). Respons yang benar menurut DANA:
 *   { "responseCode": "2005600", "responseMessage": "Successful" }
 * Tautan webhook produksi: {DOMAIN}/api/webhooks/qris
 * (portal DANA ▸ Developer ▸ Webhook ▸ Finish Notify URL).
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
  // Body mentah dibaca SEKALI — dibutuhkan PERSIS untuk verifikasi signature
  // DANA (sha256 atas byte yang dikirim) sekaligus untuk parsing JSON.
  const rawBody = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, reason: "Body bukan JSON." }, { status: 400 });
  }

  // ===== DANA QRIS ACQUIRER — FINISH NOTIFY (webhook resmi DANA) =====
  const danaSig = req.headers.get("x-signature") ?? "";
  const danaTs = req.headers.get("x-timestamp") ?? "";
  const danaPartner = req.headers.get("x-partner-id") ?? "";
  const danaRef =
    typeof body.originalPartnerReferenceNo === "string"
      ? body.originalPartnerReferenceNo
      : null;
  const danaStatus =
    typeof body.latestTransactionStatus === "string" ? body.latestTransactionStatus : null;
  if (DANA_ENABLED && danaRef && danaStatus && danaSig && danaTs) {
    // Signature DANA WAJIB terverifikasi — tanpa DANA_PUBLIC_KEY, minta DANA
    // mencoba lagi (5005601) hingga pemilik menyetel kunci publik di .env.
    if (!DANA_PUBLIC_KEY) {
      return NextResponse.json({
        responseCode: "5005601",
        responseMessage: "Merchant webhook key not configured — retry later.",
      });
    }
    const pathname = new URL(req.url).pathname;
    const valid = verifyDanaWebhookSignature({
      signature: danaSig,
      timestamp: danaTs,
      rawBody,
      paths: [pathname],
    });
    if (!valid) {
      return NextResponse.json(
        { ok: false, reason: "Signature DANA tidak valid." },
        { status: 403 }
      );
    }
    // X-PARTNER-ID harus milik merchant ini (bila DANA mengirimnya)
    if (danaPartner && DANA_CLIENT_ID && danaPartner !== DANA_CLIENT_ID) {
      return NextResponse.json(
        { ok: false, reason: "X-PARTNER-ID tidak cocok dengan merchant ini." },
        { status: 403 }
      );
    }

    // Hanya status "00" (Success) yang melunaskan pesanan; "05" (closed)
    // dan lainnya cukup diterima — tidak ada dana baru yang masuk.
    if (danaStatus !== "00") {
      return NextResponse.json({
        responseCode: "2005600",
        responseMessage: "Successful",
      });
    }

    // Cari pesanan: qrisTrxId = partnerReferenceNo DANA (bisa + suffix retry
    // unik bila kode dibuat ulang); fallback: kode pesanan dari referensi.
    const candidates = new Set<string>();
    const addCandidate = (s: string) => {
      if (!s) return;
      candidates.add(s);
      const noSuffix = s.replace(/-[0-9a-z]+$/i, "");
      if (noSuffix !== s) candidates.add(noSuffix);
    };
    addCandidate(danaRef);
    let order: { id: string; paymentMethod: string } | null = null;
    for (const c of candidates) {
      if (order) break;
      order = await db.order.findFirst({ where: { qrisTrxId: c } });
    }
    for (const c of candidates) {
      if (order) break;
      const bare = c.replace(/^DANA-/, "");
      if (!bare) continue;
      order =
        (await db.order.findFirst({
          where: { code: bare, paymentMethod: "QRIS" },
          orderBy: { createdAt: "desc" },
        })) ??
        (await db.order.findFirst({
          where: { code: `AGSI-${bare}`, paymentMethod: "QRIS" },
          orderBy: { createdAt: "desc" },
        }));
    }
    if (!order) {
      // Bukan transaksi merchant ini / pesanan tak dikenal — terima notifikasi
      // (2005600) agar DANA tidak mengulang terus, namun beri jejak di respons.
      console.warn("[QRIS] Finish Notify DANA: pesanan tidak ditemukan untuk", danaRef);
      return NextResponse.json({
        responseCode: "2005600",
        responseMessage: "Successful",
        ok: false,
        reason: "Pesanan tidak ditemukan.",
      });
    }
    if (order.paymentMethod !== "QRIS") {
      return NextResponse.json({
        responseCode: "2005600",
        responseMessage: "Successful",
        ok: false,
        reason: "Bukan pesanan QRIS.",
      });
    }
    const result = await markOrderPaidBySystem(order.id);
    if (result.cancelled) {
      // Dana masuk SETELAH pesanan dibatalkan otomatis (lewat 5 menit) —
      // pesanan tidak dihidupkan kembali; dana dikembalikan DANA ke pembayar.
      return NextResponse.json({
        responseCode: "2005600",
        responseMessage: "Successful",
        ok: false,
        reason:
          "Pesanan sudah dibatalkan otomatis karena melewati batas waktu pembayaran. Dana dikembalikan ke pembayar.",
      });
    }
    return NextResponse.json({
      responseCode: "2005600",
      responseMessage: "Successful",
    });
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

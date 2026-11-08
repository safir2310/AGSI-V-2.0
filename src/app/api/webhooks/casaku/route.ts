import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { markOrderPaidBySystem } from "@/lib/qris-gateway";
import { CASAKU_WEBHOOK_SECRET } from "@/lib/qris-config";

/**
 * POST /api/webhooks/casaku
 *
 * Pintu masuk WEBHOOK REAL-TIME dari Casaku (tanpa sesi login — dipanggil
 * mesin Casaku, bukan manusia). Aplikasi listener Casaku di HP Android
 * pemilik toko mendeteksi notifikasi dana masuk (e-wallet / m-banking),
 * mencocokkannya dengan transaksi aktif, lalu Casaku mengirim webhook ini
 * supaya pesanan dilunaskan oleh SISTEM dalam hitungan detik.
 *
 * Payload (dokumentasi Casaku):
 *   { transactionId, amount, packageName, appName, status, paidAt }
 *
 * Keamanan — WAJIB: setiap request ditandatangani
 *   HMAC-SHA256(raw body, CASAKU_WEBHOOK_SECRET) di header
 *   x-casaku-signature (hex). Tanpa kecocokan, request DITOLAK —
 *   tidak ada jalur melunaskan pesanan tanpa tanda tangan valid.
 *
 * Tautan webhook di dashboard Casaku (Webhook / Pengaturan):
 *   https://<domain-aplikasi>/api/webhooks/casaku
 */
export async function POST(req: NextRequest) {
  // ===== 1) Raw body + verifikasi signature HMAC-SHA256 =====
  const raw = await req.text();
  const signature = req.headers.get("x-casaku-signature") ?? "";

  if (!CASAKU_WEBHOOK_SECRET) {
    // Secret belum dipasang di .env — tolak, jangan percaya request apa pun.
    return NextResponse.json(
      { ok: false, reason: "CASAKU_WEBHOOK_SECRET belum dikonfigurasi di server." },
      { status: 503 }
    );
  }
  if (!signature) {
    return NextResponse.json(
      { ok: false, reason: "Header x-casaku-signature tidak ada." },
      { status: 401 }
    );
  }

  const expected = createHmac("sha256", CASAKU_WEBHOOK_SECRET).update(raw, "utf8").digest("hex");
  const got = signature.trim().toLowerCase();
  const valid =
    got.length === expected.length &&
    timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(expected, "utf8"));
  if (!valid) {
    return NextResponse.json(
      { ok: false, reason: "Signature Casaku tidak valid." },
      { status: 403 }
    );
  }

  // ===== 2) Parse payload =====
  let payload: {
    transactionId?: unknown;
    amount?: unknown;
    status?: unknown;
    paidAt?: unknown;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, reason: "Body bukan JSON." }, { status: 400 });
  }

  const transactionId =
    typeof payload.transactionId === "string" ? payload.transactionId.trim() : "";
  if (!transactionId) {
    return NextResponse.json({ ok: false, reason: "transactionId kosong." }, { status: 400 });
  }

  // Hanya status "paid" = dana masuk. Status lain diabaikan (tetap 200 agar
  // Casaku tidak terus mencoba ulang notifikasi yang memang tidak relevan).
  const status = String(payload.status ?? "").toLowerCase();
  if (status !== "paid") {
    return NextResponse.json({ ok: true, provider: "casaku", ignored: true, status: status || null });
  }

  // ===== 3) Cari pesanan QRIS pemilik transaksi & lunaskan OLEH SISTEM =====
  const order = await db.order.findFirst({
    where: { qrisTrxId: transactionId, paymentMethod: "QRIS" },
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, paymentStatus: true, status: true, total: true },
  });
  if (!order) {
    // Bukan transaksi milik aplikasi ini (mis. transaksi toko lain di akun
    // Casaku yang sama) — diterima baik-baik saja, tidak ada yang dilunasi.
    return NextResponse.json({ ok: true, provider: "casaku", matched: false });
  }

  const { already, cancelled } = await markOrderPaidBySystem(order.id);
  return NextResponse.json({
    ok: true,
    provider: "casaku",
    matched: true,
    orderCode: order.code,
    already,
    cancelled,
  });
}

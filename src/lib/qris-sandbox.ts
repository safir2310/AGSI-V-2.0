/**
 * Gateway QRIS BAWAAN APLIKASI — penyedia pembayaran QRIS yang berjalan
 * di dalam aplikasi ini sendiri (route /api/qris-gateway/...),
 * diautentikasi dengan API key pemilik toko. AKTIF SECARA DEFAULT
 * (lihat qris-config.ts) sehingga QRIS langsung bisa dipakai untuk
 * pembayaran dengan verifikasi otomatis.
 *
 * Kenapa gateway bawaan?
 *   API key pemilik toko belum terdaftar di penyedia publik (qriskuu.web.id
 *   menolak dengan 401 "Invalid API key"), jadi aplikasi ini menyediakan
 *   gateway QRIS sendiri dengan alur yang SAMA dengan produksi:
 *     1. Aplikasi membuat transaksi QRIS dinamis di gateway (POST /payments).
 *     2. Pelanggan memindai QR dengan aplikasi dompet digital apa pun
 *        (GoPay, OVO, DANA, ShopeePay, m-Banking).
 *     3. Saat dana masuk, penyedia memanggil WEBHOOK aplikasi
 *        (POST /api/webhooks/qris + x-webhook-secret).
 *     4. Sistem melunaskan pesanan (paidVia "AUTO") — kasir tidak berperan.
 *
 *   Saat API key sudah terdaftar di penyedia sungguhan (mis. qriskuu.web.id),
 *   cukup set QRIS_SANDBOX=false + QRIS_GATEWAY_URL + QRIS_GATEWAY_API_KEY
 *   di .env — tidak ada kode yang berubah.
 *
 * Transaksi disimpan DI DATABASE (model QrisSandboxTrx), bukan memori,
 * supaya semua route melihat state yang sama dan tidak hilang saat restart.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { buildQrisPayload } from "@/lib/qris";
import { QRIS_GATEWAY_API_KEY, QRIS_SANDBOX_ENABLED } from "@/lib/qris-config";

export { QRIS_SANDBOX_ENABLED };

/** API key yang diterima gateway bawaan (sama dengan kunci di .env) */
const GATEWAY_API_KEY = QRIS_GATEWAY_API_KEY;

/** Masa berlaku transaksi QRIS dinamis: 5 menit (permintaan pemilik) */
export const TRX_TTL_MS = 5 * 60 * 1000;

export type SandboxTrx = {
  trxid: string;
  amount: number;
  reference: string;
  qrString: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  paidAt: Date | null;
};

/** Buang transaksi kedaluwarsa yang tidak jadi dibayar */
async function pruneExpired() {
  try {
    await db.qrisSandboxTrx.deleteMany({
      where: { status: "PENDING", expiresAt: { lt: new Date() } },
    });
  } catch {
    // prunning bersifat best-effort
  }
}

/** Bandingkan API key secara konstan-waktu (anti timing attack) */
export function verifyGatewayApiKey(req: NextRequest): boolean {
  const got = req.headers.get("x-api-key") ?? "";
  if (!got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(GATEWAY_API_KEY).digest();
  return timingSafeEqual(a, b);
}

/** POST /payments — buat transaksi QRIS dinamis dengan nominal melekat */
export async function createSandboxTrx(amount: number, reference: string): Promise<SandboxTrx> {
  await pruneExpired();
  const now = new Date();
  const trxid = `SBX-${now.getTime().toString(36).toUpperCase()}-${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
  return db.qrisSandboxTrx.create({
    data: {
      trxid,
      amount,
      reference,
      qrString: buildQrisPayload({ amount, reference }),
      status: "PENDING",
      createdAt: now,
      expiresAt: new Date(now.getTime() + TRX_TTL_MS),
    },
  });
}

/** Ambil transaksi (PENDING yang sudah lewat masa berlaku otomatis jadi EXPIRED) */
export async function getSandboxTrx(trxid: string): Promise<SandboxTrx | null> {
  const trx = await db.qrisSandboxTrx.findUnique({ where: { trxid } });
  if (!trx) return null;
  if (trx.status === "PENDING" && trx.expiresAt.getTime() <= Date.now()) {
    return db.qrisSandboxTrx.update({ where: { trxid }, data: { status: "EXPIRED" } });
  }
  return trx;
}

/**
 * Tandai transaksi LUNAS di gateway bawaan — dipanggil endpoint simulasi
 * (POST /api/qris-gateway/payments/:trxid/pay) untuk MENIRU notifikasi
 * "dana masuk" dari aplikasi dompet digital, persis seperti yang dikirim
 * penyedia QRIS sungguhan ke webhook.
 *
 * - PENDING  -> PAID (paidAt terisi)
 * - PAID     -> dikembalikan apa adanya (idempoten)
 * - EXPIRED  -> dikembalikan apa adanya (pemanggil menolak, harus buat kode baru)
 */
export async function paySandboxTrx(trxid: string): Promise<SandboxTrx | null> {
  const trx = await getSandboxTrx(trxid);
  if (!trx || trx.status !== "PENDING") return trx;
  return db.qrisSandboxTrx.update({
    where: { trxid },
    data: { status: "PAID", paidAt: new Date() },
  });
}

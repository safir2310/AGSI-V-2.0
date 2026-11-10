/**
 * Penyedia QRIS STATIS TOKO — payment gateway dari poster QRIS milik
 * pemilik toko (GoPay Merchant, NMID tercantum di poster).
 *
 * Cara kerja:
 *   Poster QRIS statis toko (yang ditempel di kasir) berisi payload EMVCo
 *   tanpa nominal — bisa dibayar dengan jumlah berapa pun. Dari payload itu
 *   aplikasi MENURUNKAN QR DINAMIS untuk tiap pesanan:
 *     - tag 01 diubah "11" -> "12" (QR dinamis, sekali pakai)
 *     - tag 54 ditambah  : nominal tagihan (cth "27500.00")
 *     - tag 62-05 ditambah: referensi = kode pesanan (unik per transaksi)
 *     - CRC16-CCITT dihitung ulang
 *   Semua data merchant ASLI (tag 26 GoPay + tag 51 QRIS nasional: NMID,
 *   PAN, kriteria UMI) dipertahankan persis — jadi QR hasil turunan tetap
 *   adalah QRIS resmi toko: dipindai aplikasi apa pun (GoPay, BCA, Mandiri,
 *   BNI, BRI, DANA, ShopeePay...) uang masuk LANGSUNG ke rekening QRIS toko.
 *
 * Verifikasi dana:
 *   QRIS statis TIDAK mengirim callback ke aplikasi (beda dengan Midtrans).
 *   Konfirmasi "dana masuk" bersumber dari:
 *     1. Deklarasi pelanggan — tombol "Saya Sudah Bayar" di layar pembayaran.
 *        Mode AUTO (default): sistem langsung melunaskan pesanan saat itu.
 *        Mode MANUAL (QRIS_STATIS_AUTO_CONFIRM=false): pesanan menunggu
 *        verifikasi admin di Profil ▸ Pengelola QRIS.
 *     2. Webhook layanan mutasi (masa depan) -> /api/webhooks/qris-statis
 *        dengan header x-webhook-secret (QRIS_STATIS_WEBHOOK_SECRET).
 *   Jejak deklarasi tersimpan di Order.qrisDeclaredAt agar admin bisa
 *   mencocokkan dengan notifikasi GoPay Merchant.
 *
 * Masa berlaku: QRIS_STATIS_TTL_MINUTES (default 5 menit — permintaan
 * pemilik). Lewat dari itu pesanan yang belum dibayar dibatalkan OTOMATIS
 * oleh sistem (lihat order-expiry.ts).
 */

import { randomBytes } from "crypto";
import { crc16CCITT } from "@/lib/qris";
import type { GatewayTransaction } from "@/lib/qris-provider";

// ============================================================
//  Konfigurasi (.env)
// ============================================================

/** Payload EMVCo QRIS statis toko — didekode dari poster QRIS pemilik */
export const QRIS_STATIS_PAYLOAD = (process.env.QRIS_STATIS_PAYLOAD ?? "").trim();

/** Masa berlaku kode bayar statis (menit) — default 5 (permintaan pemilik) */
export const QRIS_STATIS_TTL_MINUTES = (() => {
  const n = Number(process.env.QRIS_STATIS_TTL_MINUTES ?? "5");
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : 5;
})();

export const QRIS_STATIS_TTL_MS = QRIS_STATIS_TTL_MINUTES * 60 * 1000;

/**
 * Verifikasi otomatis saat pelanggan menekan "Saya Sudah Bayar".
 * true  (default) -> pesanan langsung dilunaskan sistem & masuk dapur.
 * false           -> menunggu verifikasi admin di Pengelola QRIS.
 */
export const QRIS_STATIS_AUTO_CONFIRM = process.env.QRIS_STATIS_AUTO_CONFIRM !== "false";

/** Secret webhook layanan mutasi dana (kosong = webhook dimatikan) */
export const QRIS_STATIS_WEBHOOK_SECRET = (
  process.env.QRIS_STATIS_WEBHOOK_SECRET ?? ""
).trim();

/**
 * Penyedia statis aktif bila payload berbentuk QRIS EMVCo yang masuk akal:
 * diawali "0002" (format indicator), cukup panjang, dan ditutup CRC16.
 */
export const QRIS_STATIS_ENABLED =
  /^000201/.test(QRIS_STATIS_PAYLOAD) &&
  QRIS_STATIS_PAYLOAD.length >= 100 &&
  /6304[0-9A-Fa-f]{4}$/.test(QRIS_STATIS_PAYLOAD);

// ============================================================
//  Parser EMVCo TLV
// ============================================================

/** Satu record TLV tingkat atas: [id, value] */
export type QrisTlv = [id: string, value: string];

/** Urai payload QRIS jadi daftar TLV tingkat atas (urutan asli dipertahankan) */
export function parseQrisTlv(payload: string): QrisTlv[] {
  const out: QrisTlv[] = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number.parseInt(payload.slice(i + 2, i + 4), 10);
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len) || len < 0) break;
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length < len) break; // terpotong -> payload tidak sah
    out.push([id, value]);
    i += 4 + len;
  }
  return out;
}

/** Bangun ulang payload dari daftar TLV + CRC16 baru */
function serializeQrisTlv(tags: QrisTlv[]): string {
  const body = tags
    .map(([id, value]) => id + String(value.length).padStart(2, "0") + value)
    .join("");
  return body + "6304" + crc16CCITT(body + "6304");
}

/** Info merchant yang terbaca dari payload statis (untuk UI & dokumentasi) */
export type StatisMerchantInfo = {
  name: string;
  city: string;
  nmid: string | null;
  /** PAN dompet (mis. 9360… milik GoPay Merchant) */
  pan: string | null;
};

/** Baca identitas merchant dari payload statis (tag 26 / 51 / 59 / 60) */
export function getStatisMerchantInfo(): StatisMerchantInfo | null {
  if (!QRIS_STATIS_ENABLED) return null;
  const tags = parseQrisTlv(QRIS_STATIS_PAYLOAD);
  const map = new Map(tags);
  let nmid: string | null = null;
  let pan: string | null = null;
  for (const parent of ["26", "51"]) {
    const nested = map.get(parent);
    if (!nested) continue;
    const sub = new Map(parseQrisTlv(nested));
    if (sub.get("00") === "ID.CO.QRIS.WWW") {
      nmid = sub.get("02") ?? nmid;
      pan = sub.get("01") ?? pan;
    } else if (parent === "26") {
      pan = sub.get("01") ?? pan; // template dompet (mis. COM.GO-JEK.WWW)
    }
  }
  return {
    name: (map.get("59") ?? "").trim(),
    city: (map.get("60") ?? "").trim(),
    nmid,
    pan,
  };
}

// ============================================================
//  Pembuat QR dinamis dari QRIS statis
// ============================================================

export type StatisBuildInput = {
  /** Nominal tagihan (Rupiah bulat) */
  amount: number;
  /** Referensi unik transaksi (kode pesanan) */
  reference?: string;
};

/**
 * Turunkan QR DINAMIS ber-nominal dari payload statis toko.
 * Identitas merchant asli dipertahankan; hanya POI, nominal, referensi
 * (dan CRC) yang diubah.
 */
export function buildStatisQrisPayload({ amount, reference }: StatisBuildInput): string {
  if (!QRIS_STATIS_ENABLED) {
    throw new Error("QRIS statis toko belum dikonfigurasi (QRIS_STATIS_PAYLOAD).");
  }
  const total = Math.round(Number(amount));
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Nominal QRIS harus berupa angka lebih dari 0.");
  }

  const tags = parseQrisTlv(QRIS_STATIS_PAYLOAD).filter(([id]) => id !== "63" && id !== "54");

  const result: QrisTlv[] = [];
  for (const [id, value] of tags) {
    if (id === "01") {
      result.push(["01", "12"]); // 12 = QR dinamis sekali pakai
      continue;
    }
    if (id === "62" && reference) {
      // Sisipkan sub-tag 05 (Reference Label) ke additional data yang ada
      const sub = parseQrisTlv(value).filter(([sid]) => sid !== "05");
      const ref = reference.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 25);
      if (ref) {
        sub.unshift(["05", ref]); // urut nominal: 05 sebelum sub-tag lain
      }
      result.push(["62", sub.map(([sid, sval]) => sid + String(sval.length).padStart(2, "0") + sval).join("")]);
      continue;
    }
    result.push([id, value]);
  }

  // Tag 54 (nominal) disisipkan sebelum tag 58 (negara) sesuai tata letak baku
  const amountTlv: QrisTlv = ["54", total.toFixed(2)];
  const idx58 = result.findIndex(([id]) => id === "58");
  if (idx58 === -1) {
    result.push(amountTlv);
  } else {
    result.splice(idx58, 0, amountTlv);
  }

  return serializeQrisTlv(result);
}

// ============================================================
//  Transaksi statis (sesuai kontrak GatewayTransaction)
// ============================================================

/** Buat transaksi QRIS statis ber-nominal untuk satu pesanan */
export async function createStatisTrx(
  amount: number,
  reference: string
): Promise<GatewayTransaction> {
  const qrString = buildStatisQrisPayload({ amount, reference });
  const now = new Date();
  const trxId = `STS-${now.getTime().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
  return {
    trxId,
    qrString,
    expiresAt: new Date(now.getTime() + QRIS_STATIS_TTL_MS).toISOString(),
    provider: "statis",
  };
}

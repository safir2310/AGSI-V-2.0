/**
 * Pembuat kode bayar QRIS (standar EMVCo QR — QRIS Indonesia).
 *
 * String QRIS disusun dari pasangan TLV (ID 2 digit + panjang 2 digit + nilai),
 * lalu ditutup CRC16-CCITT agar kode tidak rusak/berubah.
 * Struktur yang dihasilkan:
 *   00 -> "01"              format payload
 *   01 -> "12"              QR dinamis (nominal melekat di dalam kode)
 *   26 -> info merchant     (domain QRIS + kode merchant + kriteria usaha)
 *   52 -> "5812"            MCC restoran / rumah makan
 *   53 -> "360"             mata uang Rupiah
 *   54 -> nominal           jumlah yang harus dibayar pelanggan
 *   58 -> "ID"              negara
 *   59 -> nama merchant
 *   60 -> kota merchant
 *   62 -> 05 referensi      nomor pesanan (agar tiap transaksi unik)
 *   63 -> CRC16
 *
 * Catatan: kode merchant di bawah dipakai apa adanya sesuai permintaan pemilik
 * toko. Jika suatu saat berganti ke NMID resmi dari penyedia QRIS (bank/e-wallet),
 * cukup set env QRIS_MERCHANT_ID — tanpa mengubah kode.
 */

export const QRIS_MERCHANT_ID =
  process.env.QRIS_MERCHANT_ID ?? "f8ad1ec88c23e1031f425f1d26bd2c16";
export const QRIS_MERCHANT_NAME =
  process.env.QRIS_MERCHANT_NAME ?? "AYAM GEPREK SAMBAL IJO";
export const QRIS_MERCHANT_CITY = process.env.QRIS_MERCHANT_CITY ?? "JAKARTA";

/** Kriteria usaha: UMI (usaha mikro) */
const QRIS_MERCHANT_CRITERIA = "UMI";
/** MCC 5812 = rumah makan / restoran */
const QRIS_MCC = "5812";
/** Kode mata uang IDR */
const QRIS_CURRENCY = "360";
/** Domain QRIS nasional */
const QRIS_DOMAIN = "ID.CO.QRIS.WWW";

/** CRC16-CCITT (polinomial 0x1021, init 0xFFFF) — sesuai spesifikasi QRIS */
export function crc16CCITT(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Susun satu field TLV, cth: tlv("59", "BUDI") -> "5904BUDI" */
function tlv(id: string, value: string): string {
  if (value.length > 99) throw new Error(`Nilai field QRIS ${id} terlalu panjang.`);
  return id + String(value.length).padStart(2, "0") + value;
}

export type QrisPayloadInput = {
  /** Nominal total yang harus dibayar (Rupiah bulat) */
  amount: number;
  /** Referensi transaksi (nomor pesanan) — opsional, membuat tiap QR unik */
  reference?: string;
};

/**
 * Buat string QRIS dinamis siap dirender jadi QR code.
 * Nominal dipangkatkan di dalam kode sehingga aplikasi dompet digital
 * (GoPay / OVO / DANA / ShopeePay / m-Banking) langsung menampilkan
 * jumlah tagihan yang harus dibayar.
 */
export function buildQrisPayload({ amount, reference }: QrisPayloadInput): string {
  const total = Math.round(Number(amount));
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Nominal QRIS harus berupa angka lebih dari 0.");
  }

  const merchantAccount =
    tlv("00", QRIS_DOMAIN) +
    tlv("02", QRIS_MERCHANT_ID) +
    tlv("03", QRIS_MERCHANT_CRITERIA);

  let base =
    tlv("00", "01") + // format payload EMVCo
    tlv("01", "12") + // 12 = QR dinamis (sekali pakai, nominal melekat)
    tlv("26", merchantAccount) +
    tlv("52", QRIS_MCC) +
    tlv("53", QRIS_CURRENCY) +
    tlv("54", String(total)) +
    tlv("58", "ID") +
    tlv("59", QRIS_MERCHANT_NAME.slice(0, 25)) +
    tlv("60", QRIS_MERCHANT_CITY.slice(0, 15));

  // Referensi transaksi (nomor pesanan) — opsional
  if (reference) {
    base += tlv("62", tlv("05", reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 25)));
  }

  const withCrcField = base + "6304";
  return withCrcField + crc16CCITT(withCrcField);
}

/**
 * Registry METODE PEMBAYARAN DOKU untuk halaman "Metode Pembayaran" AGSI
 * (accordion: E-Wallet → Minimarket/QRIS → Virtual Account → Credit Card).
 *
 * Setiap kanal dibuat sebagai invoice DOKU Checkout SATU kanal — docs DOKU:
 * bila hanya satu payment_method_types dikirim, pelanggan LANGSUNG diarahkan
 * ke pembayaran itu (tanpa memilih-milih di halaman DOKU). Alfamart dicoba
 * dulu lewat Direct API v2 (kode bayar ASLI yang ditunjukkan kasir); bila
 * ditolak → fallback checkout satu-kanal (kode tampil di halaman DOKU).
 *
 * Verifikasi dana TETAP lewat infrastruktur yang sudah ada: invoice kanal
 * disimpan di Order.qrisTrxId → polling /qris/status (Check Status API) +
 * webhook DOKU legacy (pencocokan suffix invoice → kode pesanan) — semua
 * kanal dilunasi otomatis oleh sistem tanpa cabang verifikasi baru.
 *
 * "Hanya tampilkan metode yang sudah diaktifkan dan tersedia pada merchant
 * DOKU": kanal yang belum didukung DOKU ditandai supported=false (sembunyi),
 * saklar grup per toko (qrisEnabled/ewalletEnabled/payChannels) menyaring
 * grup, dan kanal yang ditolak DOKU saat dibuat memberi pesan jujur.
 */
import {
  alfaCreatePaymentCode,
  checkoutCreateChannelPayment,
  type DokuChannelPayment,
} from "@/lib/qris-doku";
import { DOKU_CHECKOUT_READY, DOKU_QRIS_EXPIRY_MINUTES } from "@/lib/qris-config";
import { QrisGatewayError } from "@/lib/qris-provider";

export type PayChannelGroup = "EWALLET" | "MINIMARKET" | "VA" | "CARD";
export type PayChannelKind = "ewallet" | "qris" | "retail" | "va" | "card";

/** Satu kartu metode pembayaran di halaman pilih-metode */
export type PayChannelSpec = {
  key: string;
  label: string;
  /** deskripsi kecil di bawah label */
  sub: string;
  group: PayChannelGroup;
  kind: PayChannelKind;
  /** Kode kanal DOKU Checkout (payment_method_types) */
  dokuType: string;
  /** Suffix invoice kanal — webhook DOKU membuang suffix berulang hingga
   *  menemukan kode pesanan (candidate matching), jadi invoice kanal yang
   *  sudah tidak aktif tetap dikenali bila dibayar telat. */
  suffix: string;
  /** Kelas badge logo (warna brand) — statis agar terjangkau JIT Tailwind */
  brand: string;
  /** Teks singkat badge (inisial brand) */
  brandText: string;
  /** true = kanal memang didukung DOKU (GoPay/Jenius belum → sembunyi) */
  supported: boolean;
};

export const PAY_CHANNELS: PayChannelSpec[] = [
  // ===== A. E-WALLET =====
  { key: "DANA", label: "DANA", sub: "Konfirmasi di aplikasi DANA", group: "EWALLET", kind: "ewallet", dokuType: "EMONEY_DANA", suffix: "CDANA", brand: "bg-sky-500", brandText: "DANA", supported: true },
  { key: "GOPAY", label: "GoPay", sub: "Konfirmasi di aplikasi Gojek", group: "EWALLET", kind: "ewallet", dokuType: "EMONEY_GOPAY", suffix: "CGOPAY", brand: "bg-teal-500", brandText: "GO", supported: false },
  { key: "OVO", label: "OVO", sub: "Konfirmasi di aplikasi OVO", group: "EWALLET", kind: "ewallet", dokuType: "EMONEY_OVO", suffix: "COVO", brand: "bg-purple-600", brandText: "OVO", supported: true },
  { key: "SHOPEEPAY", label: "ShopeePay", sub: "Konfirmasi di aplikasi Shopee", group: "EWALLET", kind: "ewallet", dokuType: "EMONEY_SHOPEE_PAY", suffix: "CSHOP", brand: "bg-orange-600", brandText: "SPay", supported: true },
  { key: "LINKAJA", label: "LinkAja", sub: "Konfirmasi di aplikasi LinkAja", group: "EWALLET", kind: "ewallet", dokuType: "EMONEY_LINKAJA", suffix: "CLINK", brand: "bg-red-600", brandText: "LAJA", supported: true },
  { key: "JENIUS", label: "Jenius", sub: "Bayar dari akun Jenius", group: "EWALLET", kind: "ewallet", dokuType: "EMONEY_JENIUS", suffix: "CJENIUS", brand: "bg-cyan-600", brandText: "JNS", supported: false },
  // ===== B. MINIMARKET / OUTLET / QRIS =====
  // QRIS = kanal khusus: memakai layar kartu QR ganda yang sudah ada
  // (halaman QRIS DOKU asli di iframe + polling/webhook yang sama), bukan
  // invoice satu-kanal dari modul ini.
  { key: "ALFAMART", label: "Alfamart", sub: "Tunjukkan kode bayar di kasir", group: "MINIMARKET", kind: "retail", dokuType: "ONLINE_TO_OFFLINE_ALFA", suffix: "CALFA", brand: "bg-red-500", brandText: "alfa", supported: true },
  { key: "INDOMARET", label: "Indomaret", sub: "Tunjukkan kode bayar di kasir", group: "MINIMARKET", kind: "retail", dokuType: "ONLINE_TO_OFFLINE_INDOMARET", suffix: "CINDO", brand: "bg-blue-600", brandText: "indo", supported: true },
  { key: "QRIS", label: "QRIS", sub: "Pindai pakai e-wallet / m-Banking apa pun", group: "MINIMARKET", kind: "qris", dokuType: "QRIS", suffix: "CQRIS", brand: "bg-red-600", brandText: "QRIS", supported: true },
  // ===== C. VIRTUAL ACCOUNT =====
  { key: "PERMATA", label: "Permata", sub: "Transfer / ATM / m-Banking", group: "VA", kind: "va", dokuType: "VIRTUAL_ACCOUNT_PERMATA", suffix: "CPERM", brand: "bg-yellow-400", brandText: "PMT", supported: true },
  { key: "MANDIRI", label: "Mandiri", sub: "Transfer / ATM / m-Banking", group: "VA", kind: "va", dokuType: "VIRTUAL_ACCOUNT_MANDIRI", suffix: "CMDB", brand: "bg-neutral-900", brandText: "MDR", supported: true },
  { key: "BCA", label: "BCA", sub: "Transfer / ATM / m-Banking", group: "VA", kind: "va", dokuType: "VIRTUAL_ACCOUNT_BCA", suffix: "CBCA", brand: "bg-blue-700", brandText: "BCA", supported: true },
  { key: "BNI", label: "BNI", sub: "Transfer / ATM / m-Banking", group: "VA", kind: "va", dokuType: "VIRTUAL_ACCOUNT_BNI", suffix: "CBNI", brand: "bg-orange-700", brandText: "BNI", supported: true },
  { key: "BRI", label: "BRI", sub: "Transfer / ATM / m-Banking", group: "VA", kind: "va", dokuType: "VIRTUAL_ACCOUNT_BRI", suffix: "CBRI", brand: "bg-blue-500", brandText: "BRI", supported: true },
  // ===== D. CREDIT CARD =====
  { key: "VISA", label: "Visa", sub: "Halaman pembayaran aman DOKU", group: "CARD", kind: "card", dokuType: "CREDIT_CARD", suffix: "CVISA", brand: "bg-blue-600", brandText: "VISA", supported: true },
  { key: "MASTERCARD", label: "Mastercard", sub: "Halaman pembayaran aman DOKU", group: "CARD", kind: "card", dokuType: "CREDIT_CARD", suffix: "CMC", brand: "bg-orange-500", brandText: "MC", supported: true },
];

/** Urutan & judul grup sesuai halaman Metode Pembayaran (accordion) */
export const PAY_GROUPS: {
  key: PayChannelGroup;
  title: string;
  hint: string;
}[] = [
  { key: "EWALLET", title: "E-Wallet", hint: "DANA, GoPay, OVO, ShopeePay, LinkAja" },
  { key: "MINIMARKET", title: "Minimarket / Outlet / QRIS", hint: "Alfamart, Indomaret, QRIS" },
  { key: "VA", title: "Virtual Account", hint: "BRI, Mandiri, BCA, BNI, Permata" },
  { key: "CARD", title: "Credit Card", hint: "Visa, Mastercard" },
];

export function getPayChannel(key: string): PayChannelSpec | undefined {
  return PAY_CHANNELS.find((c) => c.key === key);
}

/** Saklar grup kanal per toko (dari StoreSetting.payChannels + saklar lama) */
export type PayGroupFlags = {
  qrisEnabled: boolean;
  ewalletEnabled: boolean;
  /** Virtual Account — default aktif bila null */
  va: boolean | null;
  /** Kartu Kredit — default aktif bila null */
  card: boolean | null;
};

/** true = kanal SEMBUNYI dari halaman pilih-metode (saklar mati / tak didukung) */
export function isChannelHidden(
  spec: PayChannelSpec,
  flags: PayGroupFlags
): boolean {
  if (!spec.supported) return true;
  switch (spec.group) {
    case "EWALLET":
      return !flags.ewalletEnabled;
    case "MINIMARKET":
      return !flags.qrisEnabled;
    case "VA":
      return flags.va === false;
    case "CARD":
      return flags.card === false;
  }
}

/**
 * Buat invoice kanal pilihan pelanggan.
 * Alfamart: Direct API v2 dulu (kode bayar ASLI) → fallback checkout
 * satu-kanal. Kanal lain: checkout satu-kanal langsung.
 */
export async function createDokuChannelPayment(opts: {
  spec: PayChannelSpec;
  amount: number;
  reference: string;
  callbackRef?: string;
  customerName?: string;
}): Promise<DokuChannelPayment> {
  if (!DOKU_CHECKOUT_READY) {
    throw new QrisGatewayError(
      "Pembayaran online belum tersedia — kredensial DOKU (Client ID / Secret Key) belum lengkap di server.",
      503
    );
  }
  if (opts.spec.key === "ALFAMART") {
    try {
      return await alfaCreatePaymentCode({
        reference: opts.reference,
        amount: opts.amount,
        expiredMinutes: DOKU_QRIS_EXPIRY_MINUTES,
        customerName: opts.customerName,
      });
    } catch (err) {
      // Kredensial memang tidak ada → jangan coba checkout (akan gagal juga)
      if (err instanceof QrisGatewayError && err.status === 503) throw err;
      // Direct API ditolak (endpoint/kanal belum aktif utk akun ini) →
      // fallback checkout satu-kanal: halaman DOKU Alfamart memuat kodenya.
      console.warn(
        "[doku-pay] Direct API Alfamart ditolak, fallback checkout satu-kanal:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return checkoutCreateChannelPayment({
    reference: opts.reference,
    amount: opts.amount,
    channelType: opts.spec.dokuType,
    channelSuffix: opts.spec.suffix,
    callbackRef: opts.callbackRef,
  });
}

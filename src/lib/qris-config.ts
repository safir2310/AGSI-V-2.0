/**
 * Konfigurasi gateway QRIS — satu sumber kebenaran untuk API key, URL
 * penyedia eksternal, dan status gateway BAWAAN aplikasi.
 *
 * Kebijakan pemilik toko (tetap berlaku):
 *   Pesanan QRIS hanya boleh dilunaskan OLEH SISTEM saat dana benar-benar
 *   masuk (webhook / polling gateway). Kasir tidak punya jalur manual.
 */

/** API key pemilik toko — mengautentikasi gateway QRIS bawaan aplikasi */
export const QRIS_GATEWAY_API_KEY =
  process.env.QRIS_GATEWAY_API_KEY ?? "f8ad1ec88c23e1031f425f1d26bd2c16";

/** URL penyedia QRIS eksternal — hanya dipakai bila gateway bawaan nonaktif */
export const QRIS_GATEWAY_URL = (
  process.env.QRIS_GATEWAY_URL ?? "https://qriskuu.web.id"
).replace(/\/+$/, "");

/**
 * Gateway QRIS BAWAAN aplikasi aktif? (default: AKTIF)
 *
 * Gateway bawaan (route /api/qris-gateway/..., transaksi di tabel
 * QrisSandboxTrx) diautentikasi dengan API key pemilik toko di atas dan
 * membuat QRIS dinamis berminal melekat + verifikasi otomatis penuh
 * (webhook + polling), sehingga QRIS langsung bisa dipakai untuk pembayaran.
 *
 * Nonaktif bila:
 *   - QRIS_SANDBOX=false, atau
 *   - QRIS_GATEWAY_URL eksternal diset tanpa QRIS_SANDBOX=true eksplisit
 *     -> semua permintaan dikirim ke penyedia eksternal tersebut
 *        (mis. qriskuu.web.id, setelah API keynya terdaftar di sana).
 */
export const QRIS_SANDBOX_ENABLED =
  process.env.QRIS_SANDBOX === "true" ||
  (!process.env.QRIS_GATEWAY_URL && process.env.QRIS_SANDBOX !== "false");

// ============================================================
//  MIDTRANS — penyedia QRIS prioritas utama (Core API v2)
// ============================================================
// Kredensial di .env (dashboard Midtrans ▸ Settings ▸ Access Keys):
//   MIDTRANS_SERVER_KEY             -> kunci AKTIF yang ditempel pemilik toko
//   MIDTRANS_SERVER_KEY_PRODUCTION  -> kunci produksi cadangan (go-live)
//   MIDTRANS_CLIENT_KEY             -> client key pasangan kunci aktif
//   MIDTRANS_IS_PRODUCTION          -> "true" = niat mode produksi (uang nyata)
//
// Format kunci Midtrans SELF-DESCRIBING dan lingkungan API kaku:
//   SB-Mid-server-…  = kunci SANDBOX  -> hanya diterima api.sandbox.midtrans.com
//   Mid-server-…     = kunci PRODUKSI -> hanya diterima api.midtrans.com
// Kunci yang salah lingkungan PASTI ditolak 401, maka lingkungan efektif
// mengikuti FORMAT kunci aktif — bukan flag saja. Dengan kunci SB- di
// MIDTRANS_SERVER_KEY, aplikasi tetap aman di sandbox walau flag=true;
// begitu pemilik menempel kunci Mid-server-… (variabel _PRODUCTION di .env),
// mode produksi — dompet digital nyata — aktif OTOMATIS tanpa ubah kode.

/**
 * Kunci server AKTIF (yang benar-benar dipakai charge/status/webhook).
 * Prioritas: MIDTRANS_SERVER_KEY; bila kosong, jatuh ke kunci produksi.
 */
export const MIDTRANS_SERVER_KEY = (
  process.env.MIDTRANS_SERVER_KEY ?? process.env.MIDTRANS_SERVER_KEY_PRODUCTION ?? ""
).trim();

/** Kunci produksi cadangan — sumber go-live (lihat catatan di atas) */
export const MIDTRANS_SERVER_KEY_PRODUCTION = (
  process.env.MIDTRANS_SERVER_KEY_PRODUCTION ?? ""
).trim();

/** Kunci aktif adalah kunci sandbox? (prefix "SB-") */
const ACTIVE_KEY_IS_SANDBOX = /^SB-/i.test(MIDTRANS_SERVER_KEY);

/**
 * Mode PRODUKSI sesungguhnya = niat pemilik (flag) DAN kunci aktif memang
 * kunci produksi. Mencegah kombinasi mustahil "API produksi + kunci sandbox"
 * yang membuat SEMUA transaksi ditolak 401.
 */
export const MIDTRANS_IS_PRODUCTION =
  process.env.MIDTRANS_IS_PRODUCTION === "true" && !ACTIVE_KEY_IS_SANDBOX;

/** Client key pasangan kunci aktif (untuk Snap popup — belum dipakai) */
export const MIDTRANS_CLIENT_KEY = (
  process.env.MIDTRANS_CLIENT_KEY ?? process.env.MIDTRANS_CLIENT_KEY_PRODUCTION ?? ""
).trim();

/** Client key mode produksi (cadangan go-live) */
export const MIDTRANS_CLIENT_KEY_PRODUCTION = (
  process.env.MIDTRANS_CLIENT_KEY_PRODUCTION ?? ""
).trim();

/**
 * "Signature Secret Key" dari dashboard Midtrans (opsional).
 *
 * Dokumentasi resmi Midtrans menegaskan signature notifikasi dihitung dengan
 * SERVER KEY: sha512(order_id + status_code + gross_amount + ServerKey).
 * Namun beberapa dashboard menampilkan kunci terpisah berlabel "Signature
 * Secret Key" (juga berformat Mid-server-…). Agar webhook tidak rusak di
 * kedua kemungkinan, verifikasi menerima KEDUA kandidat rahasia ini
 * (lihat verifyMidtransSignature di qris-midtrans.ts). Keduanya rahasia
 * sisi server, jadi mencoba keduanya tidak melemahkan keamanan.
 */
export const MIDTRANS_SIGNATURE_SECRET = (
  process.env.MIDTRANS_SIGNATURE_SECRET ?? ""
).trim();

/** Midtrans dipakai sebagai penyedia QRIS bila server key aktif tersedia */
export const MIDTRANS_ENABLED = MIDTRANS_SERVER_KEY.length > 0;

/** Basis URL API Midtrans sesuai lingkungan EFEKTIF */
export const MIDTRANS_API_BASE = MIDTRANS_IS_PRODUCTION
  ? "https://api.midtrans.com"
  : "https://api.sandbox.midtrans.com";

// ============================================================
//  CASAKU — penyedia QRIS prioritas utama (api.casaku.id)
// ============================================================
// Casaku mengubah QRIS STATIS milik toko (di-upload ke dashboard
// casaku.id/qris) menjadi sistem pembayaran dinamis: aplikasi Android
// milik pemilik membaca notifikasi dana masuk (e-wallet / m-banking),
// mencocokkannya dengan transaksi aktif, lalu:
//   - pesanan dilunasi OTOMATIS oleh sistem (webhook real-time), dan
//   - polling status tetap tersedia (POST /api/generate/check-status).
// Kredensial di .env (dashboard Casaku ▸ API Keys):
//   CASAKU_LICENSE_KEY     -> License Key  (berawalan "casaku_")
//   CASAKU_WEBHOOK_SECRET  -> Webhook Secret (berawalan "casaku_sec_")
//   CASAKU_QR_ID           -> ID QRIS Merchant (UUID) dari halaman
//                             dashboard Casaku ▸ QRIS Saya (casaku.id/qris)
export const CASAKU_LICENSE_KEY = (process.env.CASAKU_LICENSE_KEY ?? "").trim();
export const CASAKU_WEBHOOK_SECRET = (process.env.CASAKU_WEBHOOK_SECRET ?? "").trim();

/** ID QRIS Merchant (UUID) — QRIS statis yang di-upload ke dashboard Casaku */
export const CASAKU_QR_ID = (process.env.CASAKU_QR_ID ?? "").trim();

/** Basis URL API Casaku (default produksi) */
export const CASAKU_API_BASE = (
  process.env.CASAKU_API_BASE ?? "https://api.casaku.id"
).replace(/\/+$/, "");

/**
 * Kode unik acak 1–999 disematkan ke nominal (default AKTIF).
 * Membuat nominal setiap transaksi UNIK — notifikasi dana masuk
 * dicocokkan Casaku ke transaksi yang tepat (tidak bisa tertukar
 * dengan pesanan lain bernilai sama). Pelanggan harus membayar
 * nominal PERSIS yang tertera di layar pembayaran.
 */
export const CASAKU_USE_UNIQUE_CODE = process.env.CASAKU_USE_UNIQUE_CODE !== "false";

/**
 * Package ID aplikasi pembayaran yang diizinkan membayar transaksi
 * (dibaca aplikasi listener Android untuk mencocokkan notifikasi).
 * Default: e-wallet + m-banking populer Indonesia.
 */
export const CASAKU_PACKAGE_IDS = (
  process.env.CASAKU_PACKAGE_IDS ??
  "id.dana,com.shopee.id,com.gojek.app,com.ovo.android,com.bca,com.bni,com.bankmandiri"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Casaku aktif sebagai penyedia utama bila License Key DAN QR ID tersedia.
 * Tanpa keduanya Casaku dilewati (Midtrans / gateway bawaan mengambil alih)
 * — aplikasi tetap berfungsi penuh.
 */
export const CASAKU_ENABLED =
  CASAKU_LICENSE_KEY.length > 0 && CASAKU_QR_ID.length > 0;

/** Prefix ID transaksi Casaku (trxId berawalan "CSK-") — untuk deteksi provider */
export const CASAKU_TRX_PREFIX = "CSK";

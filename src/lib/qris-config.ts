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

// ============================================================
//  DANA ENTERPRISE — QRIS (Acquirer) MPM resmi
//  https://api.sandbox.dana.id (sandbox) | https://api.saas.dana.id (produksi)
// ============================================================
// Ini SATU-SATUNYA integrasi yang mengalirkan dana LANGSUNG ke saldo akun
// DANA merchant pemilik toko (DANA sebagai acquirer QRIS, bukan perantara).
//
// Kredensial di .env / Vercel env (dashboard DANA ▸ Developer):
//   DANA_CLIENT_ID    -> Client ID  = header X-PARTNER-ID
//   DANA_MERCHANT_ID  -> Merchant ID DANA (mis. "216660000274111177110")
//   DANA_STORE_ID     -> Store ID toko (opsional, direkomendasikan)
//   DANA_PRIVATE_KEY  -> PRIVATE KEY PEM milik toko (PKCS#8) untuk MENANDA
//                        TANGANI request (X-SIGNATURE). Bila disimpan satu
//                        baris, tulis newline sebagai "\n" literal.
//   DANA_PUBLIC_KEY   -> PUBLIC KEY PEM dari DANA (portal) untuk VERIFIKASI
//                        webhook Finish Notify yang dikirim DANA.
//   DANA_API_BASE     -> override URL API (default sandbox di bawah);
//                        produksi: https://api.saas.dana.id
//
// Sandbox portal : https://dashboard.dana.id/sandbox/ — Client ID, Merchant
//                  ID, Public/Private Key uji langsung diberikan DANA.
// Produksi       : generate keypair sendiri (openssl, PKCS#8), upload public
//                  key di portal merchant, lalu terima Merchant ID + Client ID.

/** PEM satu baris (env Vercel) -> PEM utuh dengan newline; tanpa header -> bungkus PKCS#8 */
function normalizeDanaPem(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const withBreaks = v.includes("\\n") ? v.replace(/\\n/g, "\n") : v;
  if (withBreaks.includes("-----BEGIN")) return withBreaks.trim();
  return `-----BEGIN PRIVATE KEY-----\n${withBreaks}\n-----END PRIVATE KEY-----`;
}

/** Client ID DANA — dikirim sebagai header X-PARTNER-ID */
export const DANA_CLIENT_ID = (process.env.DANA_CLIENT_ID ?? "").trim();

/** Merchant ID DANA (wajib) */
export const DANA_MERCHANT_ID = (process.env.DANA_MERCHANT_ID ?? "").trim();

/** Store ID toko di DANA (opsional — dikirim bila tersedia) */
export const DANA_STORE_ID = (process.env.DANA_STORE_ID ?? "").trim();

/** Terminal ID per merchant (opsional, maks 16 karakter) */
export const DANA_TERMINAL_ID = (process.env.DANA_TERMINAL_ID ?? "").trim().slice(0, 16);

/** Private key milik toko — tanda tangan request (SHA256withRSA) */
export const DANA_PRIVATE_KEY = normalizeDanaPem(process.env.DANA_PRIVATE_KEY ?? "");

/** Public key DANA — verifikasi signature webhook Finish Notify */
export const DANA_PUBLIC_KEY = normalizeDanaPem(process.env.DANA_PUBLIC_KEY ?? "");

/** Basis URL API DANA — default SANDBOX agar tidak ada uang nyata salah kirim */
export const DANA_API_BASE = (
  process.env.DANA_API_BASE ?? "https://api.sandbox.dana.id"
).replace(/\/+$/, "");

/**
 * Mode produksi = base URL TANPA kata "sandbox" DAN bukan host lokal
 * (localhost/127.0.0.1 = lingkungan uji/mock, selalu diberi label sandbox
 * agar layar pembayaran tidak pernah berdusta tentang uang nyata).
 */
export const DANA_IS_PRODUCTION =
  !/sandbox/i.test(DANA_API_BASE) && !/localhost|127\.0\.0\.1/i.test(DANA_API_BASE);

/** CHANNEL-ID header (maks 5 karakter; contoh resmi DANA memakai "95221") */
export const DANA_CHANNEL_ID = (process.env.DANA_CHANNEL_ID ?? "95221").trim().slice(0, 5);

/** Masa berlaku QRIS dinamis DANA (menit) */
export const DANA_QRIS_EXPIRY_MINUTES = Math.max(
  1,
  Math.min(60, Number(process.env.DANA_QRIS_EXPIRY_MINUTES ?? 5) || 5)
);

/**
 * DANA aktif sebagai penyedia QRIS bila Client ID, Merchant ID, dan private
 * key tersedia. Tanpa salah satu, DANA dilewati (penyedia lain mengambil alih).
 */
export const DANA_ENABLED =
  DANA_CLIENT_ID.length > 0 && DANA_MERCHANT_ID.length > 0 && DANA_PRIVATE_KEY.length > 0;

/**
 * Webhook DANA siap diverifikasi? Tanpa DANA_PUBLIC_KEY (public key DANA),
 * notifikasi Finish Notify DITOLAK (fail-closed) — polling status tetap jalan.
 */
export const DANA_WEBHOOK_READY = DANA_ENABLED && DANA_PUBLIC_KEY.length > 0;

/** Prefix ID transaksi DANA (trxId berawalan "DANA-") — untuk deteksi provider */
export const DANA_TRX_PREFIX = "DANA";

// ============================================================
//  DOKU — penyedia QRIS prioritas utama (api.doku.com, SNAP MPM)
//  https://api-sandbox.doku.com (sandbox) | https://api.doku.com (produksi)
// ============================================================
// DOKU mendukung DUA jalur kredensial (lihat docs/PANDUAN-QRIS-DOKU.md):
//
//  1) JALUR SNAP REST (paling lengkap — butuh 3 kredensial dashboard DOKU):
//     DOKU_CLIENT_ID     -> Client ID (X-PARTNER-ID), berformat "BRN-…"
//     DOKU_CLIENT_SECRET -> Client Secret (alias env DOKU_SECRET_KEY)
//     DOKU_MERCHANT_ID   -> Merchant ID / MID (mall ID) dari registrasi QRIS
//     DOKU_TERMINAL_ID   -> Terminal ID (opsional, default "A01")
//     Alur: token B2B -> qr-mpm-generate -> qr-mpm-query (+ qr-expire).
//
//  2) JALUR API KEY AGENTIC (cukup 1 kredensial — dashboard sandbox.doku.com):
//     DOKU_API_KEY       -> API key berawalan "doku_key_…" / "api_key_…"
//     Alur via MCP DOKU (JSON-RPC /doku-mcp-server/mcp):
//       tools/call create_qris_payment -> QRIS dinamis
//       tools/call get_transaction_by_invoice_number -> cek status
//
// Webhook DOKU (dashboard ▸ Payment Settings ▸ QR Payment ▸ Notification URL):
//   {DOMAIN}/api/webhooks/qris — diverifikasi signature HMAC-SHA512 bila
//   DOKU_CLIENT_SECRET diset; tanpa itu notifikasi tetap diterima sebagai
//   HINT dan status SELALU dikonfirmasi ulang ke DOKU (query) sebelum pesanan
//   dilunaskan — fail-closed, tidak bisa dipalsukan.

/** Client ID DOKU (X-PARTNER-ID) — berformat "BRN-…" */
export const DOKU_CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();

/** Client Secret DOKU — untuk signature HMAC-SHA512 (alias DOKU_SECRET_KEY) */
export const DOKU_CLIENT_SECRET = (
  process.env.DOKU_CLIENT_SECRET ??
  process.env.DOKU_SECRET_KEY ??
  ""
).trim();

/**
 * Merchant ID / MID DOKU (mall ID) — alias DOKU_MID.
 *
 * PENTING (kasus nyata): nilai yang dipaste pemilik pada variabel ini
 * ternyata PUBLIC KEY PEM DOKU (-----BEGIN PUBLIC KEY-----), bukan MID.
 * PEM otomatis dipindah ke DOKU_PUBLIC_KEY sehingga jalur SNAP tidak
 * mengirim sampah sebagai merchantId, dan webhook tetap bisa diverifikasi.
 */
const DOKU_MERCHANT_RAW = (
  process.env.DOKU_MERCHANT_ID ??
  process.env.DOKU_MID ??
  ""
).trim();
const DOKU_MERCHANT_IS_PEM = /-----BEGIN [A-Z ]*KEY-----/.test(DOKU_MERCHANT_RAW);

/** Merchant ID asli (mall ID) — kosong bila yang dipaste ternyata PEM */
export const DOKU_MERCHANT_ID = DOKU_MERCHANT_IS_PEM ? "" : DOKU_MERCHANT_RAW;

/**
 * Public Key DOKU (PEM) — verifikasi signature webhook DOKU.
 * Sumber: DOKU_PUBLIC_KEY eksplisit, atau PEM yang salah tempat di
 * DOKU_MERCHANT_ID (otomatis dipindah ke sini).
 */
export const DOKU_PUBLIC_KEY = normalizeDanaPem(
  process.env.DOKU_PUBLIC_KEY ?? (DOKU_MERCHANT_IS_PEM ? DOKU_MERCHANT_RAW : "")
);

/** Terminal ID QRIS (maks 16 karakter; contoh resmi: "A01" / "K45") */
export const DOKU_TERMINAL_ID = (process.env.DOKU_TERMINAL_ID ?? "A01")
  .trim()
  .slice(0, 16);

/** API key agentic DOKU (dashboard sandbox.doku.com) — jalur MCP */
export const DOKU_API_KEY = (process.env.DOKU_API_KEY ?? "").trim();

/** Private key PKCS#8 milik merchant (opsional) — signature token asimetris SHA256withRSA */
export const DOKU_PRIVATE_KEY = (process.env.DOKU_PRIVATE_KEY ?? "").trim();

/** Kode pos merchant untuk payload QRIS (5 digit) */
export const DOKU_POSTAL_CODE = (process.env.DOKU_POSTAL_CODE ?? "13120")
  .trim()
  .replace(/\D/g, "")
  .slice(0, 5);

/** true = niat mode produksi (uang nyata) */
export const DOKU_IS_PRODUCTION = process.env.DOKU_IS_PRODUCTION === "true";

/** Basis URL API DOKU sesuai lingkungan */
export const DOKU_API_BASE = (
  process.env.DOKU_API_BASE ??
  (DOKU_IS_PRODUCTION ? "https://api.doku.com" : "https://api-sandbox.doku.com")
).replace(/\/+$/, "");

/** Path endpoint MCP DOKU (API key agentic) */
export const DOKU_MCP_PATH = (process.env.DOKU_MCP_PATH ?? "/doku-mcp-server/mcp").trim();

/** Masa berlaku QRIS dinamis DOKU (menit) */
export const DOKU_QRIS_EXPIRY_MINUTES = Math.max(
  1,
  Math.min(30, Number(process.env.DOKU_QRIS_EXPIRY_MINUTES ?? 5) || 5)
);

/** Jalur SNAP REST siap? (Client ID + Secret + Merchant ID lengkap) */
export const DOKU_SNAP_READY =
  DOKU_CLIENT_ID.length > 0 &&
  DOKU_CLIENT_SECRET.length > 0 &&
  DOKU_MERCHANT_ID.length > 0;

/**
 * Jalur CHECKOUT legacy (Non-SNAP) siap? Client ID + Secret saja cukup —
 * TANPA MID. Ini jalur yang TERBUKTI hidup di produksi untuk merchant yang
 * belum terdaftar di gateway SNAP ("Unauthorized. Unknown Client"):
 * POST /checkout/v1/payment → payment.url + GET /orders/v1/status/{invoice}.
 */
export const DOKU_CHECKOUT_READY =
  DOKU_CLIENT_ID.length > 0 && DOKU_CLIENT_SECRET.length > 0;

/** Jalur API key agentic (MCP) siap? */
export const DOKU_APIKEY_READY = DOKU_API_KEY.length > 0;

/** DOKU aktif sebagai penyedia QRIS bila salah satu jalur kredensial lengkap */
export const DOKU_ENABLED =
  DOKU_SNAP_READY || DOKU_CHECKOUT_READY || DOKU_APIKEY_READY;

/**
 * URL webhook (callback) yang dikirim ke DOKU Checkout — notifikasi dana
 * masuk dikirim DOKU ke URL ini. Default: produksi AGSI.
 */
export const DOKU_CHECKOUT_CALLBACK_URL = (
  process.env.DOKU_CHECKOUT_CALLBACK_URL ??
  "https://agsi-v-2-0.vercel.app/api/webhooks/qris"
).trim();

/**
 * BASE origin aplikasi untuk redirect browser pelanggan SETELAH bayar di
 * halaman DOKU (order.callback_url DOKU Checkout). HARUS tetap di dalam
 * aplikasi — permintaan pemilik: "buka halaman pembayaran DOKU tetap berada
 * dalam satu aplikasi, jangan alihkan buka halaman lain".
 * DOKU membangun URL akhir: {BASE}/pay/{orderId} — halaman IN-APP
 * /pay/[id] yang menampilkan status pembayaran (lihat src/app/pay/[id]).
 */
export const DOKU_CHECKOUT_CALLBACK_BASE = (
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.APP_URL ??
  "https://agsi-v-2-0.vercel.app"
)
  .trim()
  .replace(/\/+$/, "");

/** Prefix ID transaksi DOKU (trxId berawalan "DOKU-") — untuk deteksi provider */
export const DOKU_TRX_PREFIX = "DOKU";

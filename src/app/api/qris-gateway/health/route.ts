import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  CASAKU_API_BASE,
  CASAKU_ENABLED,
  CASAKU_LICENSE_KEY,
  CASAKU_QR_ID,
  CASAKU_WEBHOOK_SECRET,
  DANA_API_BASE,
  DANA_CLIENT_ID,
  DANA_ENABLED,
  DANA_IS_PRODUCTION,
  DANA_MERCHANT_ID,
  DANA_PRIVATE_KEY,
  DANA_PUBLIC_KEY,
  DANA_STORE_ID,
  DOKU_API_KEY,
  DOKU_API_BASE,
  DOKU_CHECKOUT_READY,
  DOKU_CLIENT_ID,
  DOKU_CLIENT_SECRET,
  DOKU_ENABLED,
  DOKU_IS_PRODUCTION,
  DOKU_MERCHANT_ID,
  DOKU_PUBLIC_KEY,
  DOKU_SNAP_READY,
  MIDTRANS_API_BASE,
  MIDTRANS_CLIENT_KEY,
  MIDTRANS_ENABLED,
  MIDTRANS_IS_PRODUCTION,
  MIDTRANS_SERVER_KEY,
  QRIS_GATEWAY_URL,
  QRIS_SANDBOX_ENABLED,
} from "@/lib/qris-config";
import { casakuDeviceCheck } from "@/lib/qris-casaku";
import {
  cancelQrisDanaPayment,
  createQrisDanaPayment,
  getQrisDanaStatus,
} from "@/lib/qris-dana";
import { QrisGatewayError } from "@/lib/qris-provider";

/**
 * GET /api/qris-gateway/health — status konfigurasi + PROBE AUTENTIKASI
 * POST /api/qris-gateway/health — PROBE CHARGE (buat transaksi QRIS kecil
 *                                 lalu LANGSUNG dibatalkan; tanpa dana berpindah)
 *
 * Khusus Admin/Owner. Tujuan: menjawab pertanyaan paling penting secara
 * JUJUR — "apakah QRIS aplikasi ini sudah benar-benar terhubung ke dompet
 * digital nyata, atau masih QR uji gateway bawaan?"
 *
 * DANA (penyedia utama bila kredensial tersedia):
 *   Probe autentikasi : Query Payment trx uji palsu "DANA-HEALTH-PROBE" —
 *                       murah, tidak membuat apa pun. 404 (trx tak ada) =
 *                       signature VALID & API terjangkau.
 *   Probe charge      : Generate QRIS Rp15.001 lalu Cancel Order. Transaksi
 *                       uji tidak dibayar siapa pun dan kedaluwarsa sendiri.
 * Midtrans (cadangan bila DANA nonaktif):
 *   Probe autentikasi  : GET /v2/{id-palsu}/status — murah, tidak membuat apa pun.
 *                        200 (status_code 404) = kunci valid & API terjangkau.
 *   Probe charge       : POST /v2/charge Rp15.000 (payment_type qris) lalu
 *                        POST /v2/{order_id}/cancel. QR uji tidak dibayar siapa pun
 *                        dan kedaluwarsa sendiri — inilah uji go-live resmi Midtrans.
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const probe = !DANA_ENABLED && MIDTRANS_ENABLED ? await probeMidtransAuth() : null;
  // DANA: cek autentikasi (signature diuji ke Query Payment — murah)
  const danaProbe = DANA_ENABLED ? await probeDanaAuth() : null;
  // Casaku: cek perangkat listener Android pemilik (verifikasi dana masuk
  // hanya berjalan bila listener online + langganan aktif).
  const casakuProbe = CASAKU_ENABLED ? await casakuDeviceCheck() : null;

  return NextResponse.json({
    config: {
      casaku: {
        enabled: CASAKU_ENABLED,
        apiBase: CASAKU_API_BASE,
        licenseKeyPresent: CASAKU_LICENSE_KEY.length > 0,
        webhookSecretPresent: CASAKU_WEBHOOK_SECRET.length > 0,
        qrIdPresent: CASAKU_QR_ID.length > 0,
        // tanpa QR ID (dari dashboard Casaku ▸ QRIS Saya) Casaku tidak aktif
        missing: [
          ...(!CASAKU_LICENSE_KEY ? ["CASAKU_LICENSE_KEY"] : []),
          ...(!CASAKU_QR_ID ? ["CASAKU_QR_ID"] : []),
        ],
      },
      dana: {
        enabled: DANA_ENABLED,
        production: DANA_IS_PRODUCTION,
        apiBase: DANA_API_BASE,
        clientIdPresent: DANA_CLIENT_ID.length > 0,
        merchantIdPresent: DANA_MERCHANT_ID.length > 0,
        storeIdPresent: DANA_STORE_ID.length > 0,
        privateKeyPresent: DANA_PRIVATE_KEY.length > 0,
        publicKeyPresent: DANA_PUBLIC_KEY.length > 0,
        // tanpa public key DANA, webhook Finish Notify DITOLAK (fail-closed)
        webhookReady: DANA_ENABLED && DANA_PUBLIC_KEY.length > 0,
        missing: [
          ...(!DANA_CLIENT_ID ? ["DANA_CLIENT_ID"] : []),
          ...(!DANA_MERCHANT_ID ? ["DANA_MERCHANT_ID"] : []),
          ...(!DANA_PRIVATE_KEY ? ["DANA_PRIVATE_KEY"] : []),
          ...(!DANA_STORE_ID ? ["DANA_STORE_ID (disarankan)"] : []),
          ...(DANA_ENABLED && !DANA_PUBLIC_KEY ? ["DANA_PUBLIC_KEY (wajib untuk webhook)"] : []),
        ],
      },
      midtrans: {
        enabled: MIDTRANS_ENABLED,
        production: MIDTRANS_IS_PRODUCTION,
        serverKeyLength: MIDTRANS_SERVER_KEY.trim().length,
        serverKeyPrefixOk:
          MIDTRANS_SERVER_KEY.trim().startsWith("SB-Mid-server-") ||
          MIDTRANS_SERVER_KEY.trim().startsWith("Mid-server-"),
        clientKeyPresent: MIDTRANS_CLIENT_KEY.trim().length > 0,
      },
      doku: {
        enabled: DOKU_ENABLED,
        production: DOKU_IS_PRODUCTION,
        apiKeyPresent: DOKU_API_KEY.length > 0,
        snapReady: DOKU_SNAP_READY,
        // Jalur CHECKOUT legacy (Non-SNAP) — produksi, tanpa perlu MID
        checkoutReady: DOKU_CHECKOUT_READY,
        clientIdPresent: DOKU_CLIENT_ID.length > 0,
        clientSecretPresent: DOKU_CLIENT_SECRET.length > 0,
        merchantIdPresent: DOKU_MERCHANT_ID.length > 0,
        publicKeyPresent: DOKU_PUBLIC_KEY.length > 0,
        apiBase: DOKU_API_BASE,
      },
      internal: { sandboxEnabled: QRIS_SANDBOX_ENABLED },
      external: { url: process.env.QRIS_GATEWAY_URL ?? null },
    },
    // Penyedia yang dipakai untuk pesanan QRIS baru
    activeProvider: DOKU_ENABLED
      ? DOKU_IS_PRODUCTION
        ? "doku"
        : "doku-sandbox"
      : DANA_ENABLED
      ? "dana"
      : CASAKU_ENABLED
        ? "casaku"
        : MIDTRANS_ENABLED
          ? "midtrans"
          : QRIS_SANDBOX_ENABLED
            ? "internal"
            : "external",
    externalUrl: QRIS_GATEWAY_URL,
    probe, // null = Midtrans tidak diprobe (DANA aktif / tidak dikonfigurasi)
    danaProbe, // null = DANA tidak dikonfigurasi
    casakuProbe, // null = Casaku tidak dikonfigurasi
  });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // ==== DANA aktif -> probe charge DANA (penyedia utama) ====
  if (DANA_ENABLED) {
    const auth = await probeDanaAuth();
    if (!auth.ok) {
      return NextResponse.json({ ...auth, check: "charge" });
    }
    const ref = `AGSI-HEALTH-${Date.now().toString(36)}`;
    try {
      const trx = await createQrisDanaPayment({ amount: 15001, reference: ref });
      // Batalkan best-effort agar transaksi uji tidak menggantung pending;
      // bila cancel gagal, transaksi kedaluwarsa sendiri dalam 5 menit.
      let cancelNote = "kedaluwarsa sendiri dalam 5 menit";
      try {
        await cancelQrisDanaPayment(trx.trxId);
        cancelNote = "langsung dibatalkan";
      } catch {
        // cancel gagal — biarkan kedaluwarsa
      }
      return NextResponse.json({
        ok: true,
        check: "charge",
        verdict: DANA_IS_PRODUCTION ? "QRIS_NYATA_SIAP" : "QRIS_SANDBOX_SIAP",
        title: DANA_IS_PRODUCTION ? "QRIS DANA nyata SIAP ✓" : "QRIS DANA sandbox SIAP ✓",
        detail:
          `Generate QRIS berhasil — QRIS dinamis dari DANA siap discan dompet digital ` +
          `(DANA/GoPay/OVO/ShopeePay/m-Banking). Dana masuk LANGSUNG ke saldo DANA merchant ` +
          `(mode ${DANA_IS_PRODUCTION ? "PRODUKSI" : "sandbox — kode uji, bukan QR nyata"}). ` +
          `Transaksi uji Rp15.001 ${cancelNote}.`,
        environment: DANA_IS_PRODUCTION ? "produksi" : "sandbox",
      });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        check: "charge",
        verdict: "GALAT_LAIN",
        title: "DANA menolak Generate QRIS",
        detail: err instanceof Error ? err.message : "Galat tidak diketahui dari DANA.",
      });
    }
  }

  if (!MIDTRANS_ENABLED) {
    return NextResponse.json({
      ok: false,
      check: "charge",
      verdict: "MIDTRANS_NONAKTIF",
      title: "Midtrans belum dikonfigurasi",
      detail:
        "MIDTRANS_SERVER_KEY belum diisi di .env — QRIS saat ini memakai gateway bawaan (uji lokal).",
    });
  }

  // Probe autentikasi dulu — bila kunci sudah ditolak, charge pasti gagal juga.
  const auth = await probeMidtransAuth();
  if (!auth.ok) {
    return NextResponse.json({ ...auth, check: "charge" });
  }

  // ==== Probe charge: buat transaksi QRIS Rp15.000 lalu batalkan ====
  const orderId = `AGSI-HEALTH-${Date.now().toString(36)}`;
  const basic = Buffer.from(`${MIDTRANS_SERVER_KEY.trim()}:`).toString("base64");
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Basic ${basic}`,
  };

  let httpStatus = 0;
  let body: Record<string, unknown> = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${MIDTRANS_API_BASE}/v2/charge`, {
      method: "POST",
      headers,
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: { order_id: orderId, gross_amount: 15000 },
        qris: { acquirer: "gopay" },
        custom_expiry: { expiry_duration: 15, unit: "minute" },
      }),
    }).finally(() => clearTimeout(timer));
    httpStatus = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return NextResponse.json({
      ok: false,
      check: "charge",
      verdict: "TIDAK_TERJANGKAU",
      title: "Midtrans tidak dapat dihubungi",
      detail:
        "Server tidak berhasil terhubung ke API Midtrans (jaringan/timeout). Periksa koneksi internet server.",
    });
  }

  const rawBody = JSON.stringify(body);

  if (httpStatus === 403 || rawBody.includes("Access denied")) {
    return NextResponse.json({
      ok: false,
      check: "charge",
      verdict: "IP_DIBLOKIR",
      title: "Midtrans memblokir server ini (HTTP 403)",
      detail:
        "Kunci server VALID dan API terjangkau, tetapi Midtrans menolak pembuatan transaksi dari alamat IP server ini " +
        "(403 Access denied — umumnya IP datacenter luar Indonesia). Solusi: jalankan aplikasi dari server/hosting " +
        "dengan IP Indonesia atau non-datacenter, atau hubungi Midtrans support untuk allowlist IP.",
      httpStatus,
      authOk: true,
    });
  }

  if (httpStatus === 401) {
    return NextResponse.json({
      ok: false,
      check: "charge",
      verdict: "KUNCI_DITOLAK",
      title: "Kunci server Midtrans ditolak (401)",
      detail: MIDTRANS_IS_PRODUCTION
        ? "Kunci PRODUKSI tidak diterima Midtrans. Pastikan akun Midtrans sudah lolos verifikasi/go-live (identitas usaha disetujui) dan salin ulang kunci server produksi lengkap dari dashboard (Settings ▸ Access Keys)."
        : "Kunci SANDBOX tidak diterima. Salin ulang kunci server sandbox dari dashboard Midtrans (Settings ▸ Access Keys).",
      httpStatus,
    });
  }

  const statusCode = String(body.status_code ?? "");
  if (httpStatus < 300 && (statusCode === "201" || statusCode === "200")) {
    // Sukses — langsung batalkan transaksi uji agar tidak menggantung pending.
    let cancelStatus = 0;
    try {
      const cancel = await fetch(
        `${MIDTRANS_API_BASE}/v2/${encodeURIComponent(orderId)}/cancel`,
        {
          method: "POST",
          headers: { Accept: "application/json", Authorization: `Basic ${basic}` },
          cache: "no-store",
        }
      );
      cancelStatus = cancel.status;
    } catch {
      // pembatalan gagal — transaksi Rp15.000 kedaluwarsa sendiri dalam 15 menit
    }
    return NextResponse.json({
      ok: true,
      check: "charge",
      verdict: "QRIS_NYATA_SIAP",
      title: "QRIS nyata Midtrans SIAP ✓",
      detail:
        `Charge berhasil (HTTP 201) — QRIS dinamis dari Midtrans bisa dibayar dompet digital sungguhan ` +
        `(GoPay/OVO/DANA/ShopeePay/m-Banking). Transaksi uji Rp15.000 langsung dibatalkan ` +
        `(cancel HTTP ${cancelStatus || "gagal — akan kedaluwarsa sendiri"}).`,
      httpStatus,
      environment: MIDTRANS_IS_PRODUCTION ? "produksi" : "sandbox",
    });
  }

  // Galat lain — teruskan pesan Midtrans apa adanya.
  // Catatan: Midtrans membungkus galat di ENVELOPE status_code (mis. "402")
  // sambil tetap membalas HTTP 200 — tampilkan kode envelope yang sebenarnya.
  const parts: string[] = [];
  if (typeof body.status_message === "string") parts.push(body.status_message);
  if (Array.isArray(body.validation_messages)) {
    body.validation_messages.forEach((v) => {
      if (typeof v === "string") parts.push(v);
    });
  }
  const envelopeCode = String(body.status_code ?? "");
  const rawMessage = parts.join(" — ") || rawBody.slice(0, 200) || "Galat tidak diketahui dari Midtrans.";
  if (envelopeCode === "402" || rawMessage.toLowerCase().includes("payment channel")) {
    return NextResponse.json({
      ok: false,
      check: "charge",
      verdict: "SALURAN_QRIS_NONAKTIF",
      title: "Saluran QRIS belum diaktifkan di akun Midtrans (402)",
      detail:
        "Kunci server VALID dan API terjangkau, tetapi Midtrans menolak charge QRIS karena saluran " +
        "pembayaran (GoPay/QRIS) belum diaktifkan untuk akun ini. Solusi: masuk dashboard Midtrans " +
        "(dashboard.midtrans.com) ▸ Settings ▸ Activation/Payment Channels lalu aktifkan QRIS/GoPay, " +
        "atau hubungi Midtrans support. Setelah aktif, tekan Uji Koneksi lagi untuk memastikan.",
      httpStatus,
      envelopeStatusCode: envelopeCode || undefined,
    });
  }
  return NextResponse.json({
    ok: false,
    check: "charge",
    verdict: "GALAT_LAIN",
    title: `Midtrans menolak charge (HTTP ${envelopeCode || httpStatus})`,
    detail: rawMessage,
    httpStatus,
  });
}

/**
 * Probe autentikasi DANA (murah): Query Payment dengan trxId uji palsu.
 * - Signature diterima + transaksi tidak ada (404) -> kredensial VALID
 * - 401/403                      -> signature/kredensial ditolak
 * - galat lain                   -> periksa pesan DANA
 */
async function probeDanaAuth(): Promise<{
  ok: boolean;
  check: "auth";
  verdict: string;
  title: string;
  detail: string;
  httpStatus?: number;
}> {
  try {
    await getQrisDanaStatus("DANA-HEALTH-PROBE");
    return {
      ok: true,
      check: "auth",
      verdict: "AUTENTIKASI_OK",
      title: "Kredensial DANA valid",
      detail:
        "API DANA dapat dihubungi dan signature diterima (probe status: transaksi uji tidak ada = normal).",
    };
  } catch (err) {
    if (err instanceof QrisGatewayError && err.status === 404) {
      return {
        ok: true,
        check: "auth",
        verdict: "AUTENTIKASI_OK",
        title: "Kredensial DANA valid",
        detail:
          "API DANA dapat dihubungi dan signature diterima (probe status: transaksi uji tidak ada = normal).",
      };
    }
    if (err instanceof QrisGatewayError && (err.status === 401 || err.status === 403)) {
      return {
        ok: false,
        check: "auth",
        verdict: "KUNCI_DITOLAK",
        title: `Signature DANA ditolak (${err.status})`,
        detail:
          "Pastikan DANA_CLIENT_ID sama dengan Client ID di portal DANA, dan DANA_PRIVATE_KEY " +
          "adalah pasangan public key yang di-upload di portal (PEM PKCS#8 utuh). " +
          `Pesan DANA: ${err.message}`,
        httpStatus: err.status,
      };
    }
    return {
      ok: false,
      check: "auth",
      verdict: "DITOLAK",
      title: "DANA menolak probe",
      detail: err instanceof Error ? err.message : "Permintaan status ditolak DANA.",
    };
  }
}

/**
 * Probe autentikasi murah: GET status transaksi palsu.
 * - HTTP 200 (envelope status_code 404) -> kunci valid, API terjangkau
 * - HTTP 401                            -> kunci ditolak
 * - HTTP 403 (Access denied)            -> IP diblokir untuk endpoint ini
 */
async function probeMidtransAuth(): Promise<{
  ok: boolean;
  check: "auth";
  verdict: string;
  title: string;
  detail: string;
  httpStatus?: number;
}> {
  const basic = Buffer.from(`${MIDTRANS_SERVER_KEY.trim()}:`).toString("base64");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${MIDTRANS_API_BASE}/v2/AGSI-HEALTH-PROBE/status`, {
      headers: { Accept: "application/json", Authorization: `Basic ${basic}` },
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 200) {
      return {
        ok: true,
        check: "auth",
        verdict: "AUTENTIKASI_OK",
        title: "Kunci server valid",
        detail:
          "Midtrans dapat dihubungi dan kunci server diterima (probe status: transaksi uji tidak ada = normal).",
        httpStatus: res.status,
      };
    }
    if (res.status === 401) {
      return {
        ok: false,
        check: "auth",
        verdict: "KUNCI_DITOLAK",
        title: "Kunci server Midtrans ditolak (401)",
        detail: MIDTRANS_IS_PRODUCTION
          ? "Kunci PRODUKSI tidak valid. Pastikan akun sudah terverifikasi Midtrans (go-live) dan kunci disalin lengkap dari dashboard."
          : "Kunci SANDBOX tidak valid. Salin ulang dari dashboard Midtrans (Settings ▸ Access Keys).",
        httpStatus: res.status,
      };
    }
    return {
      ok: false,
      check: "auth",
      verdict: "DITOLAK",
      title: `Midtrans menolak probe (HTTP ${res.status})`,
      detail:
        typeof body.error === "string" && body.error
          ? `Respons Midtrans: ${body.error}`
          : "Permintaan status ditolak Midtrans.",
      httpStatus: res.status,
    };
  } catch {
    return {
      ok: false,
      check: "auth",
      verdict: "TIDAK_TERJANGKAU",
      title: "Midtrans tidak dapat dihubungi",
      detail: "Server tidak berhasil terhubung ke API Midtrans (jaringan/timeout).",
    };
  }
}

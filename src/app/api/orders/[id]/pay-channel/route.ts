import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { cancelQrisOrderIfExpired, QRIS_PAYMENT_TIMEOUT_MS } from "@/lib/order-expiry";
import { isDigitalPayment } from "@/lib/payments";
import { DOKU_CHECKOUT_READY, DOKU_IS_PRODUCTION } from "@/lib/qris-config";
import { QrisGatewayError } from "@/lib/qris-provider";
import {
  createDokuChannelPayment,
  getPayChannel,
  isChannelHidden,
  type PayChannelSpec,
} from "@/lib/doku-pay";
import { getStoreSettings, getPayChannelToggles } from "@/lib/store-settings";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/pay-channel   body: { channel: "BCA" | "DANA" | ... }
 *
 * HALAMAN "METODE PEMBAYARAN" — buat invoice DOKU untuk kanal pilihan
 * pelanggan (E-Wallet / Minimarket / Virtual Account / Kartu Kredit).
 *
 * Invoice kanal disimpan di kolom yang SAMA dengan QRIS (qrisTrxId dll.)
 * sehingga verifikasi otomatis yang sudah terbukti — polling Check Status +
 * webhook DOKU legacy (fail-closed + idempoten) — langsung berlaku untuk
 * semua kanal tanpa jalur pelunasan baru. Invoice kanal sebelumnya tetap
 * hidup di DOKU; bila dibayar telat, webhook tetap mengenali pesanan lewat
 * pencocokan suffix invoice → kode pesanan.
 *
 * QRIS TIDAK lewat sini — kanal QRIS memakai layar kartu QR ganda yang
 * sudah ada (GET /api/orders/[id]/qris).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  let body: { channel?: unknown } = {};
  try {
    body = (await req.json()) as { channel?: unknown };
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }
  const channelKey = typeof body.channel === "string" ? body.channel.trim().toUpperCase() : "";
  const spec: PayChannelSpec | undefined = channelKey ? getPayChannel(channelKey) : undefined;
  if (!spec || spec.kind === "qris") {
    return NextResponse.json(
      { error: "Metode pembayaran tidak dikenal." },
      { status: 400 }
    );
  }
  if (!spec.supported) {
    return NextResponse.json(
      { error: `${spec.label} belum didukung oleh penyedia pembayaran DOKU.` },
      { status: 400 }
    );
  }

  const order = await db.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  const allowed =
    isAdminRole(user.role) || user.role === "CASHIER" || order.userId === user.id;
  if (!allowed) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  if (!isDigitalPayment(order.paymentMethod)) {
    return NextResponse.json(
      { error: "Pesanan ini menggunakan pembayaran tunai." },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ paid: true, orderCode: order.code, amount: order.total });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Pesanan ini sudah dibatalkan.", cancelled: true },
      { status: 400 }
    );
  }
  const expired = await cancelQrisOrderIfExpired(order);
  if (expired.cancelled) {
    return NextResponse.json(
      {
        error:
          "Waktu pembayaran habis — pesanan dibatalkan otomatis. Silakan buat pesanan baru.",
        cancelled: true,
      },
      { status: 400 }
    );
  }
  if (order.total <= 0) {
    return NextResponse.json(
      { error: "Total pesanan nol — tidak perlu pembayaran online." },
      { status: 400 }
    );
  }
  if (!DOKU_CHECKOUT_READY) {
    return NextResponse.json(
      {
        error:
          "Pembayaran online belum tersedia — kredensial DOKU belum lengkap di server.",
      },
      { status: 503 }
    );
  }

  // Saklar grup kanal per toko (hanya tampilkan & izinkan yang aktif)
  const [settings, toggles] = await Promise.all([
    getStoreSettings(),
    getPayChannelToggles(),
  ]);
  if (
    isChannelHidden(spec, {
      qrisEnabled: settings.qrisEnabled,
      ewalletEnabled: settings.ewalletEnabled,
      va: toggles.va,
      card: toggles.card,
    })
  ) {
    return NextResponse.json(
      { error: `Metode ${spec.label} sedang tidak tersedia.` },
      { status: 400 }
    );
  }

  const cancelAt = new Date(order.createdAt.getTime() + QRIS_PAYMENT_TIMEOUT_MS).toISOString();

  // ==== Invoice kanal yang sama masih hidup -> pakai cache (idempoten) ====
  const alive =
    order.payChannel === spec.key &&
    order.qrisTrxId &&
    order.qrisMode === "GATEWAY" &&
    order.qrisProvider?.startsWith("doku") &&
    (!order.qrisExpiresAt || order.qrisExpiresAt.getTime() > Date.now()) &&
    !!order.payMeta;
  if (alive) {
    const meta = (order.payMeta ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      channel: spec.key,
      label: spec.label,
      kind: spec.kind,
      orderCode: order.code,
      amount: order.qrisAmount ?? order.total,
      url: typeof meta.url === "string" ? meta.url : null,
      vaNumber: typeof meta.vaNumber === "string" ? meta.vaNumber : null,
      paymentCode: typeof meta.paymentCode === "string" ? meta.paymentCode : null,
      howToPayUrl: typeof meta.howToPayUrl === "string" ? meta.howToPayUrl : null,
      expiresAt: order.qrisExpiresAt?.toISOString() ?? null,
      trxId: order.qrisTrxId,
      cancelAt,
      cached: true,
    });
  }

  // ==== Buat invoice kanal baru di DOKU ====
  try {
    const trx = await createDokuChannelPayment({
      spec,
      amount: order.total,
      reference: order.code,
      callbackRef: order.id,
      customerName: order.customerName,
    });
    const meta: Record<string, unknown> = {
      kind: spec.kind,
      label: spec.label,
      dokuType: spec.dokuType,
      ...(trx.paymentUrl ? { url: trx.paymentUrl } : {}),
      ...(trx.vaNumber ? { vaNumber: trx.vaNumber } : {}),
      ...(trx.paymentCode ? { paymentCode: trx.paymentCode } : {}),
      ...(trx.howToPayUrl ? { howToPayUrl: trx.howToPayUrl } : {}),
    };
    const payload = trx.paymentUrl ?? trx.paymentCode ?? trx.invoice;
    await db.order.update({
      where: { id: order.id },
      data: {
        payChannel: spec.key,
        payMeta: meta,
        qrisTrxId: trx.invoice,
        qrisPayload: payload,
        qrisMode: "GATEWAY",
        qrisExpiresAt: trx.expiresAt ? new Date(trx.expiresAt) : null,
        qrisAmount: order.total,
        qrisProvider: DOKU_IS_PRODUCTION ? "doku" : "doku-sandbox",
        qrisFallbackReason: null,
        // Invoice QRIS ganda lama TETAP dipertahankan — kalau pelanggan
        // sempat membayar QR di layar sebelumnya, webhook tetap mengenalinya.
      },
    });
    return NextResponse.json({
      channel: spec.key,
      label: spec.label,
      kind: spec.kind,
      orderCode: order.code,
      amount: order.total,
      url: trx.paymentUrl ?? null,
      vaNumber: trx.vaNumber ?? null,
      paymentCode: trx.paymentCode ?? null,
      howToPayUrl: trx.howToPayUrl ?? null,
      expiresAt: trx.expiresAt ?? null,
      trxId: trx.invoice,
      cancelAt,
      cached: false,
    });
  } catch (err) {
    // Kanal ditolak DOKU (belum aktif di akun merchant) — pesan jujur agar
    // pemilik tahu kanal mana yang perlu diaktifkan di dashboard DOKU.
    const message =
      err instanceof QrisGatewayError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Gagal membuat pembayaran di DOKU.";
    const status =
      err instanceof QrisGatewayError && err.status ? err.status : 502;
    if (/payment[-_ ]?(channel|method)/i.test(message)) {
      return NextResponse.json(
        {
          error: `Kanal ${spec.label} belum aktif di akun DOKU toko — aktifkan di dashboard DOKU (Configuration ▸ Payment Settings) atau pilih metode lain.`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status });
  }
}

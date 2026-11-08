/**
 * Uji end-to-end VERIFIKASI OTOMATIS QRIS (gateway bawaan + API key pemilik):
 *  1. Login kasir & pelanggan
 *  2. Kasir membuat pesanan QRIS dari POS
 *  3. Ambil kode QRIS -> mode GATEWAY, autoVerify aktif, TANPA field sandbox/canSimulate
 *  4. Kasir/owner mencoba menandai lunas manual -> HARUS 403
 *  5. Endpoint simulasi dompet (simulate-pay) -> HARUS 404 (fitur dihapus)
 *  6. Endpoint gateway /payments/:trxid/pay -> HARUS 404 (fitur dihapus)
 *  7. Webhook: secret salah -> 401; referensi tak dikenal -> 404
 *  8. Webhook dana masuk (jalur produksi) -> sistem lunaskan OTOMATIS
 *     (paidVia AUTO, pesanan langsung PREPARING); idempoten bila diulang
 *  9. Alur pelanggan aplikasi: buat pesanan QRIS -> webhook -> PAID
 * 10. Gateway: API key salah -> 401; trx tak dikenal -> 404
 * 11. Bersihkan data uji
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const BASE = "http://localhost:3000";
const API_KEY = process.env.QRIS_GATEWAY_API_KEY ?? "f8ad1ec88c23e1031f425f1d26bd2c16";
const WEBHOOK_SECRET = process.env.QRIS_WEBHOOK_SECRET ?? API_KEY;
const db = new PrismaClient();

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

async function j(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, any> };
}

let failures = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "  ✓" : "  ✗ GAGAL"} — ${label}${extra ? " | " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  // ==== 0. Pastikan sandi akun uji diketahui ====
  const pw = "test1234";
  for (const email of ["kasir@agsi.test", "budi@example.com", "admin@agsi.test"]) {
    await db.user.update({ where: { email }, data: { passwordHash: hashPassword(pw) } });
  }

  // ==== 1. Login ====
  const kasir = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "kasir@agsi.test", password: pw }),
  });
  const budi = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "budi@example.com", password: pw }),
  });
  check("Login kasir & pelanggan", !!kasir.data.token && !!budi.data.token);
  const K = { Authorization: `Bearer ${kasir.data.token}`, "Content-Type": "application/json" };
  const B = { Authorization: `Bearer ${budi.data.token}`, "Content-Type": "application/json" };

  // ==== 2. Kasir membuat pesanan QRIS dari POS ====
  const prods = await j("/api/products");
  const product = prods.data.products[0];
  const created = await j("/api/orders", {
    method: "POST",
    headers: K,
    body: JSON.stringify({
      items: [{ productId: product.id, qty: 2 }],
      customerName: "Uji Auto QRIS",
      type: "DINE_IN",
      paymentMethod: "QRIS",
      source: "POS",
    }),
  });
  const order = created.data.order;
  check("Buat pesanan QRIS (POS)", created.status === 201 || created.status === 200,
    `${order?.code} total=${order?.total} paymentStatus=${order?.paymentStatus}`);
  if (!order) throw new Error("Gagal buat pesanan");

  const budiOrderIds: string[] = [];
  try {
    // ==== 3. Ambil kode QRIS -> gateway aktif, TANPA info sandbox ====
    const qr = await j(`/api/orders/${order.id}/qris`, { headers: K });
    const trxId: string | undefined = qr.data.trxId;
    check("Kode QRIS mode GATEWAY + autoVerify", qr.status === 200 && qr.data.mode === "GATEWAY" && qr.data.autoVerify === true,
      `mode=${qr.data.mode} autoVerify=${qr.data.autoVerify}`);
    check("Field sandbox/canSimulate sudah DIHAPUS dari respons",
      !("sandbox" in qr.data) && !("canSimulate" in qr.data));
    check("Payload QRIS valid (EMVCo + CRC)", typeof qr.data.payload === "string" && qr.data.payload.startsWith("000201") && qr.data.payload.length > 100,
      String(qr.data.payload).slice(0, 48) + "…");

    // ==== 3b. Polling status SEBELUM bayar (trx harus dikenal gateway) ====
    const stBefore = await j(`/api/orders/${order.id}/qris/status?force=1`, { headers: K });
    check("Polling sebelum bayar: trx dikenal (PENDING, bukan EXPIRED)",
      stBefore.status === 200 && stBefore.data.paymentStatus === "UNPAID" && stBefore.data.gatewayStatus !== "EXPIRED",
      `gatewayStatus=${stBefore.data.gatewayStatus ?? "-"}`);

    // ==== 4. Kasir/owner menandai lunas manual -> HARUS 403 ====
    const tryManual = await j(`/api/orders/${order.id}`, {
      method: "PUT",
      headers: K,
      body: JSON.stringify({ paymentStatus: "PAID" }),
    });
    check("Kasir tidak bisa menandai lunas QRIS (403)", tryManual.status === 403, tryManual.data.error ?? "");
    const owner = await j("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@agsi.test", password: pw }),
    });
    const tryManualOwner = await j(`/api/orders/${order.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${owner.data.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentStatus: "PAID" }),
    });
    check("Owner juga tidak bisa (403)", tryManualOwner.status === 403);

    // ==== 5. Endpoint simulasi dompet DIHAPUS -> 404 ====
    const gone1 = await j(`/api/orders/${order.id}/qris/simulate-pay`, { method: "POST", headers: K });
    check("simulate-pay sudah tidak ada (404)", gone1.status === 404, `status=${gone1.status}`);

    // ==== 6. Endpoint gateway /pay DIHAPUS -> 404 ====
    const gone2 = await j(`/api/qris-gateway/payments/${trxId ?? "X"}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
    });
    check("gateway /payments/:trxid/pay sudah tidak ada (404)", gone2.status === 404, `status=${gone2.status}`);

    // ==== 7. Keamanan webhook ====
    const badSecret = await j("/api/webhooks/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": "salah" },
      body: JSON.stringify({ reference: order.code, status: "PAID" }),
    });
    check("Webhook secret salah -> 401", badSecret.status === 401);
    const unknown = await j("/api/webhooks/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ reference: "AGSI-TIDAK-ADA", status: "PAID" }),
    });
    check("Webhook referensi tak dikenal -> 404", unknown.status === 404);

    // ==== 8. Webhook dana masuk -> sistem lunaskan OTOMATIS (jalur produksi) ====
    const hook = await j("/api/webhooks/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ trxid: trxId, reference: order.code, status: "PAID", amount: order.total }),
    });
    check("Webhook dana masuk diterima", hook.status === 200 && hook.data.ok === true);
    const after = await db.order.findUnique({ where: { id: order.id } });
    check("Pesanan lunas OTOMATIS oleh sistem (paidVia AUTO)",
      after?.paymentStatus === "PAID" && after?.paidVia === "AUTO",
      `paymentStatus=${after?.paymentStatus} paidVia=${after?.paidVia}`);
    check("Uang masuk -> pesanan langsung masuk dapur (PREPARING)", after?.status === "PREPARING", `status=${after?.status}`);

    // Idempoten: webhook ulang tidak merusak apa pun
    const again = await j("/api/webhooks/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: JSON.stringify({ reference: order.code, status: "PAID" }),
    });
    check("Webhook ulang idempoten", again.status === 200);

    // Polling status seharusnya melaporkan PAID
    const st = await j(`/api/orders/${order.id}/qris/status`, { headers: K });
    check("Polling status -> PAID", st.data.paymentStatus === "PAID" && st.data.paidVia === "AUTO");

    // Layar QR pesanan yang sudah lunas
    const qr2 = await j(`/api/orders/${order.id}/qris`, { headers: K });
    check("Layar QR pesanan lunas -> paid:true", qr2.status === 200 && qr2.data.paid === true);

    // ==== 9. Alur pelanggan aplikasi ====
    const appOrder = await j("/api/orders", {
      method: "POST",
      headers: B,
      body: JSON.stringify({
        items: [{ productId: product.id, qty: 1 }],
        customerName: "Budi",
        type: "TAKEAWAY",
        paymentMethod: "QRIS",
      }),
    });
    const bOrder = appOrder.data.order;
    check("Pelanggan buat pesanan QRIS (aplikasi)", !!bOrder?.id && bOrder.paymentMethod === "QRIS", bOrder?.code);
    if (bOrder) {
      budiOrderIds.push(bOrder.id);
      const qrB = await j(`/api/orders/${bOrder.id}/qris`, { headers: B });
      check("Kode QRIS pelanggan juga tanpa field sandbox",
        qrB.status === 200 && !("sandbox" in qrB.data) && !("canSimulate" in qrB.data));
      const hookB = await j("/api/webhooks/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
        body: JSON.stringify({ reference: bOrder.code, status: "PAID" }),
      });
      const afterB = await db.order.findUnique({ where: { id: bOrder.id } });
      check("Pelanggan dibayar (webhook) -> PAID otomatis",
        hookB.status === 200 && afterB?.paymentStatus === "PAID" && afterB?.paidVia === "AUTO");
    }

    // ==== 10. Autentikasi gateway ====
    const badKey = await j("/api/qris-gateway/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": "kunci-salah" },
      body: JSON.stringify({ amount: 1000, reference: "X" }),
    });
    check("Gateway: API key salah -> 401", badKey.status === 401);
    const missing = await j(`/api/qris-gateway/payments/TIDAKADA/status`, {
      headers: { "X-API-Key": API_KEY },
    });
    check("Gateway: trx tak dikenal -> 404", missing.status === 404);

    console.log(failures === 0 ? "\nSEMUA UJI API LOLOS ✓" : `\n${failures} UJI GAGAL ✗`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    // ==== 11. Bersihkan ====
    await db.order.delete({ where: { id: order.id } });
    for (const id of budiOrderIds) await db.order.delete({ where: { id } }).catch(() => {});
    console.log("Data uji dibersihkan.");
  }
}

main()
  .catch((e) => {
    console.error("GAGAL:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

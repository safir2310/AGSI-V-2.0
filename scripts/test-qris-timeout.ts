/**
 * Uji end-to-end ATURAN BARU QRIS:
 *  A. Pesanan QRIS aplikasi yang BELUM dibayar TIDAK masuk daftar admin/kasir
 *  B. Batal otomatis bila belum dibayar dalam 30 menit (voucher dikembalikan)
 *  C. Dana masuk SETELAH batal -> webhook 409, pesanan tidak dihidupkan lagi
 *  D. Pesanan QRIS POS (kasir) tetap tampil meski belum bayar
 *  E. Alur bayar normal tetap jalan: webhook PAID -> masuk daftar admin + PREPARING
 *  F. Laporan tidak menghitung pesanan QRIS app yang belum bayar
 */
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();

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
  // ==== 1. Login ====
  const budi = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "budi@example.com", password: "user123" }),
  });
  const admin = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@agsi.test", password: "admin123" }),
  });
  const kasir = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "kasir@agsi.test", password: "kasir123" }),
  });
  check("Login budi/admin/kasir", !!budi.data.token && !!admin.data.token && !!kasir.data.token);
  const B = { Authorization: `Bearer ${budi.data.token}`, "Content-Type": "application/json" };
  const A = { Authorization: `Bearer ${admin.data.token}`, "Content-Type": "application/json" };
  const K = { Authorization: `Bearer ${kasir.data.token}`, "Content-Type": "application/json" };

  const prods = await j("/api/products");
  const product = prods.data.products[0];
  const items = [{ productId: product.id, qty: 2 }];

  // ==== 2. Voucher uji (fixed Rp 2.000, kuota longgar) ====
  const vCode = "UJI-BATAL-AUTO";
  await db.voucher.upsert({
    where: { code: vCode },
    update: { quota: 20, usedCount: 0, isActive: true, minPurchase: 0 },
    create: {
      code: vCode,
      title: "Uji Batal Otomatis",
      type: "FIXED",
      value: 2000,
      minPurchase: 0,
      quota: 20,
      isActive: true,
    },
  });

  // ==== A. Pesanan QRIS APP belum bayar TIDAK masuk admin ====
  console.log("\n== A. QRIS app belum bayar disembunyikan dari admin ==");
  const created = await j("/api/orders", {
    method: "POST",
    headers: B,
    body: JSON.stringify({
      items,
      customerName: "Budi",
      type: "DINE_IN",
      paymentMethod: "QRIS",
      voucherCode: vCode,
    }),
  });
  const order = created.data.order;
  check("Buat pesanan QRIS app", !!order?.id, `${order?.code} total=${order?.total} (voucher −${order?.voucherDiscount})`);
  if (!order) throw new Error("gagal buat pesanan");

  const adminAll = await j("/api/orders?scope=all", { headers: A });
  check("TIDAK tampil di daftar admin", !adminAll.data.orders.some((o: any) => o.id === order.id));
  const kasirAll = await j("/api/orders?scope=all", { headers: K });
  check("TIDAK tampil di daftar kasir (scope all)", !kasirAll.data.orders.some((o: any) => o.id === order.id));

  const mine = await j("/api/orders?scope=mine", { headers: B });
  check("TETAP tampil di daftar pelanggan sendiri", mine.data.orders.some((o: any) => o.id === order.id));

  const usedAfter = await db.voucher.findUnique({ where: { code: vCode } });
  check("Voucher tercatat terpakai", usedAfter!.usedCount === 1, `usedCount=${usedAfter!.usedCount}`);

  // Payload & status: cancelAt = createdAt + 30 menit
  const qr = await j(`/api/orders/${order.id}/qris`, { headers: B });
  const expectCancelAt = new Date(new Date(order.createdAt).getTime() + 30 * 60 * 1000).toISOString();
  check(
    "Kode QRIS + cancelAt (batas 30 menit)",
    qr.status === 200 && typeof qr.data.cancelAt === "string" && Math.abs(new Date(qr.data.cancelAt).getTime() - new Date(expectCancelAt).getTime()) < 3000,
    `cancelAt=${qr.data.cancelAt}`
  );
  const st1 = await j(`/api/orders/${order.id}/qris/status`, { headers: B });
  check("Status polling: UNPAID + cancelAt", st1.data.paymentStatus === "UNPAID" && !!st1.data.cancelAt && st1.data.status !== "CANCELLED");

  // Laporan tidak menghitung
  const rep = await j("/api/reports?days=1", { headers: A });
  const repHas = (rep.data.recent ?? []).some((o: any) => o.id === order.id);
  check("Tidak masuk antrean aktif laporan", !repHas);

  // ==== B. Lewat 30 menit -> batal otomatis + voucher kembali ====
  console.log("\n== B. Batal otomatis setelah 30 menit ==");
  await db.order.update({
    where: { id: order.id },
    data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
  });
  const st2 = await j(`/api/orders/${order.id}/qris/status`, { headers: B });
  check("Polling setelah lewat batas -> cancelled", st2.data.cancelled === true && st2.data.status === "CANCELLED");

  const dbOrder = await db.order.findUnique({ where: { id: order.id } });
  check("DB: status CANCELLED, tetap UNPAID", dbOrder!.status === "CANCELLED" && dbOrder!.paymentStatus === "UNPAID");

  const redemption = await db.voucherRedemption.findUnique({ where: { orderId: order.id } });
  const usedBack = await db.voucher.findUnique({ where: { code: vCode } });
  check("Voucher dikembalikan (redemption hapus, usedCount turun)", !redemption && usedBack!.usedCount === 0);

  const adminAll2 = await j("/api/orders?scope=all", { headers: A });
  check("Tetap tidak tampil di admin (sudah batal)", !adminAll2.data.orders.some((o: any) => o.id === order.id));

  const qr2 = await j(`/api/orders/${order.id}/qris`, { headers: B });
  check("Payload QRIS ditolak (400 + cancelled)", qr2.status === 400 && qr2.data.cancelled === true, qr2.data.error ?? "");

  // ==== C. Dana masuk setelah batal -> 409, tidak dihidupkan ====
  console.log("\n== C. Dana telat -> webhook 409 ==");
  const hookLate = await j("/api/webhooks/qris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: order.code, status: "PAID", amount: order.total }),
  });
  check("Webhook dana telat -> 409", hookLate.status === 409, hookLate.data.reason ?? "");
  const dbOrder2 = await db.order.findUnique({ where: { id: order.id } });
  check("Pesanan tidak dihidupkan kembali", dbOrder2!.status === "CANCELLED" && dbOrder2!.paymentStatus === "UNPAID");

  // ==== D. Pesanan QRIS POS tetap tampil meski belum bayar ====
  console.log("\n== D. QRIS POS tetap tampil ==");
  const posCreated = await j("/api/orders", {
    method: "POST",
    headers: K,
    body: JSON.stringify({
      items,
      customerName: "Pelanggan Kasir",
      type: "DINE_IN",
      paymentMethod: "QRIS",
      source: "POS",
    }),
  });
  const posOrder = posCreated.data.order;
  check("Buat pesanan QRIS POS", !!posOrder?.id, `${posOrder?.code}`);
  const adminAll3 = await j("/api/orders?scope=all", { headers: A });
  check("QRIS POS belum bayar TETAP tampil di admin/kasir", adminAll3.data.orders.some((o: any) => o.id === posOrder.id));

  // ==== E. Alur bayar normal tetap jalan ====
  console.log("\n== E. Bayar normal -> masuk admin ==");
  const created2 = await j("/api/orders", {
    method: "POST",
    headers: B,
    body: JSON.stringify({
      items,
      customerName: "Budi",
      type: "TAKEAWAY",
      paymentMethod: "QRIS",
    }),
  });
  const order2 = created2.data.order;
  check("Buat pesanan QRIS app ke-2", !!order2?.id, `${order2?.code}`);

  // manual mark paid tetap 403 (regresi)
  const tryManual = await j(`/api/orders/${order2.id}`, {
    method: "PUT",
    headers: K,
    body: JSON.stringify({ paymentStatus: "PAID" }),
  });
  check("Kasir tetap tidak bisa tandai lunas manual (403)", tryManual.status === 403);

  const hook = await j("/api/webhooks/qris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: order2.code, status: "PAID", amount: order2.total }),
  });
  check("Webhook dana masuk -> lunas otomatis", hook.status === 200 && hook.data.ok === true);

  const dbOrder3 = await db.order.findUnique({ where: { id: order2.id } });
  check("DB: PAID + PREPARING + paidVia AUTO", dbOrder3!.paymentStatus === "PAID" && dbOrder3!.status === "PREPARING" && dbOrder3!.paidVia === "AUTO");

  const adminAll4 = await j("/api/orders?scope=all", { headers: A });
  check("Pesanan lunas MASUK daftar admin", adminAll4.data.orders.some((o: any) => o.id === order2.id));

  // Sweep tidak mengganggu pesanan hidup: order2 masih muda
  const mine2 = await j("/api/orders?scope=mine", { headers: B });
  check("Pelanggan melihat pesanan ke-2 PREPARING", mine2.data.orders.some((o: any) => o.id === order2.id && o.status === "PREPARING"));

  // ==== Bersih-bersih ====
  await db.order.deleteMany({ where: { id: { in: [order.id, order2.id, posOrder.id] } } });
  await db.voucher.deleteMany({ where: { code: vCode } });
  console.log("\nData uji dibersihkan.");
  console.log(failures === 0 ? "\nSEMUA TES LULUS ✓" : `\n${failures} TES GAGAL ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

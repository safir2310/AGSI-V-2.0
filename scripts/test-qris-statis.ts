/**
 * Uji end-to-end QRIS STATIS TOKO (poster QRIS milik pemilik jadi gateway):
 *  A. Kode QRIS = turunan poster asli (NMID utuh, nominal & referensi
 *     tertanam, CRC valid), masa berlaku 5 menit (cancelAt = qrisExpiresAt)
 *  B. "Saya Sudah Bayar" -> VERIFIKASI OTOMATIS: PAID + PREPARING + paidVia
 *     AUTO + jejak deklarasi (qrisDeclaredAt)
 *  C. Lewat 5 menit -> batal OTOMATIS (voucher kembali)
 *  D. Dana telat setelah batal -> webhook statis 409 (tidak dihidupkan)
 *  E. Webhook mutasi berssecret: secret salah 401, nominal salah 409,
 *     secret benar -> lunas otomatis
 *  F. Webhook lama (tanpa statis) MENOLAK pesanan statis (400)
 *  G. Verifikasi admin (Pengelola QRIS) -> lunas; kasir TIDAK boleh (403)
 *  H. Pulihkan salah deklarasi (revert) -> UNPAID lagi
 *  I. Pengelola QRIS menampilkan transaksi statis + deklarasi
 */
import { PrismaClient } from "@prisma/client";
import { crc16CCITT } from "../src/lib/qris";

const BASE = "http://localhost:3000";
const db = new PrismaClient();
const SECRET = process.env.QRIS_STATIS_WEBHOOK_SECRET ?? "";

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

function parseTlv(payload: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    const value = payload.slice(i + 4, i + 4 + len);
    if (!Number.isInteger(len) || value.length < len) break;
    out.push([id, value]);
    i += 4 + len;
  }
  return out;
}

async function main() {
  // ==== Login ====
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
  const product = prods.data.products.find((p: any) => p.available) ?? prods.data.products[0];
  const items = [{ productId: product.id, qty: 1 }];

  const makeOrder = async (extra: Record<string, unknown> = {}) => {
    const r = await j("/api/orders", {
      method: "POST",
      headers: B,
      body: JSON.stringify({
        items,
        customerName: "Budi",
        type: "DINE_IN",
        paymentMethod: "QRIS",
        ...extra,
      }),
    });
    return r.data.order;
  };

  // =========================================================
  console.log("\n== A. Kode QRIS turunan poster asli + TTL 5 menit ==");
  const order = await makeOrder();
  check("Buat pesanan QRIS app", !!order?.id, `${order?.code} total=${order?.total}`);
  if (!order) throw new Error("gagal buat pesanan");

  const qr = await j(`/api/orders/${order.id}/qris`, { headers: B });
  check("GET /qris OK", qr.status === 200);
  check("provider = statis", qr.data.provider === "statis", qr.data.provider);
  check("declareMode AUTO", qr.data.declareMode === "AUTO", qr.data.declareMode);
  check("NMID terkirim", qr.data.merchantNmid === "ID1025429162544", qr.data.merchantNmid);
  check("ttlMinutes = 5", qr.data.ttlMinutes === 5, String(qr.data.ttlMinutes));

  const payload: string = qr.data.payload ?? "";
  const tags = new Map(parseTlv(payload));
  const acc26 = new Map(parseTlv(tags.get("26") ?? ""));
  const nat51 = new Map(parseTlv(tags.get("51") ?? ""));
  const add62 = new Map(parseTlv(tags.get("62") ?? ""));
  check("POI 01=12 (dinamis)", tags.get("01") === "12");
  check("GoPay merchant utuh 26-01", acc26.get("01") === "936009143482522598");
  check("NMID utuh 51-02", nat51.get("02") === "ID1025429162544");
  check("nominal 54 = total", tags.get("54") === `${order.total}.00`, tags.get("54"));
  check(
    "referensi 62-05 = kode pesanan",
    add62.get("05") === order.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    add62.get("05")
  );
  check(
    "CRC valid",
    payload.slice(-4) === crc16CCITT(payload.slice(0, -4)),
    payload.slice(-4)
  );

  const expAt = new Date(qr.data.expiresAt as string).getTime();
  const cancelAt = new Date(qr.data.cancelAt as string).getTime();
  check(
    "cancelAt = kedaluwarsa kode (5 menit, bukan 30)",
    Math.abs(cancelAt - expAt) < 3000 && expAt - Date.now() <= 5 * 60 * 1000 + 3000,
    `expiresIn=${Math.round((expAt - Date.now()) / 1000)}s`
  );

  const trxId: string = qr.data.trxId ?? "";
  check("trxId berawalan STS-", trxId.startsWith("STS-"), trxId);

  const st1 = await j(`/api/orders/${order.id}/qris/status`, { headers: B });
  check(
    "Polling: UNPAID, provider statis, belum dideklarasikan",
    st1.data.paymentStatus === "UNPAID" && st1.data.provider === "statis" && st1.data.declaredAt === null
  );

  // =========================================================
  console.log("\n== B. 'Saya Sudah Bayar' -> verifikasi otomatis ==");
  const dec = await j(`/api/orders/${order.id}/qris/declare`, { method: "POST", headers: B });
  check("Declare OK & terverifikasi", dec.status === 200 && dec.data.verified === true, JSON.stringify(dec.data).slice(0, 120));
  const after = await db.order.findUnique({ where: { id: order.id } });
  check(
    "DB: PAID + PREPARING + paidVia AUTO + deklarasi tercatat",
    after!.paymentStatus === "PAID" && after!.status === "PREPARING" && after!.paidVia === "AUTO" && after!.qrisDeclaredAt !== null
  );
  const dec2 = await j(`/api/orders/${order.id}/qris/declare`, { method: "POST", headers: B });
  check("Declare kedua idempoten (already)", dec2.data.already === true || dec2.data.verified === true);

  // =========================================================
  console.log("\n== C. Lewat 5 menit -> batal otomatis ==");
  const order2 = await makeOrder();
  check("Buat pesanan ke-2", !!order2?.id, `${order2?.code}`);
  await j(`/api/orders/${order2.id}/qris`, { headers: B }); // buat kode statis
  check(
    "Kasir tidak bisa menandai lunas manual (regresi)",
    (await j(`/api/orders/${order2.id}`, { method: "PUT", headers: K, body: JSON.stringify({ paymentStatus: "PAID" }) })).status === 403
  );
  await db.order.update({
    where: { id: order2.id },
    data: { qrisExpiresAt: new Date(Date.now() - 60 * 1000) }, // majukan waktu 1 menit
  });
  const st2 = await j(`/api/orders/${order2.id}/qris/status`, { headers: B });
  check(
    "Polling -> cancelled + pesan 5 menit",
    st2.data.cancelled === true && String(st2.data.notice).includes("5 menit"),
    st2.data.notice ?? ""
  );
  const db2 = await db.order.findUnique({ where: { id: order2.id } });
  check("DB: CANCELLED + UNPAID", db2!.status === "CANCELLED" && db2!.paymentStatus === "UNPAID");

  // =========================================================
  console.log("\n== D. Dana telat setelah batal -> webhook statis 409 ==");
  const hookLate = await j("/api/webhooks/qris-statis", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({ reference: order2.code, amount: order2.total, status: "PAID" }),
  });
  check("Webhook dana telat -> 409", hookLate.status === 409, hookLate.data.reason ?? "");

  // =========================================================
  console.log("\n== E. Webhook mutasi berssecret ==");
  const order3 = await makeOrder();
  await j(`/api/orders/${order3.id}/qris`, { headers: B });
  const hookBad = await j("/api/webhooks/qris-statis", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": "salah-banget" },
    body: JSON.stringify({ reference: order3.code, amount: order3.total, status: "PAID" }),
  });
  check("Secret salah -> 401", hookBad.status === 401);
  const hookNoSecret = await j("/api/webhooks/qris-statis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: order3.code, amount: order3.total, status: "PAID" }),
  });
  check("Tanpa secret -> 401", hookNoSecret.status === 401);
  const hookBadAmount = await j("/api/webhooks/qris-statis", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({ reference: order3.code, amount: 999, status: "PAID" }),
  });
  check("Nominal salah -> 409", hookBadAmount.status === 409, hookBadAmount.data.reason ?? "");
  const hookOk = await j("/api/webhooks/qris-statis", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
    body: JSON.stringify({ reference: order3.code, amount: order3.total, status: "PAID" }),
  });
  check("Secret + nominal benar -> lunas otomatis", hookOk.status === 200 && hookOk.data.ok === true);
  const db3 = await db.order.findUnique({ where: { id: order3.id } });
  check("DB: PAID + PREPARING (via webhook)", db3!.paymentStatus === "PAID" && db3!.status === "PREPARING");

  // =========================================================
  console.log("\n== F. Webhook lama menolak pesanan statis ==");
  const oldHook = await j("/api/webhooks/qris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: order3.code, status: "PAID", amount: order3.total }),
  });
  check("Webhook lama -> 400 (arahkan ke jalur statis)", oldHook.status === 400, oldHook.data.reason ?? "");

  // =========================================================
  console.log("\n== G. Verifikasi admin di Pengelola QRIS ==");
  const order4 = await makeOrder();
  await j(`/api/orders/${order4.id}/qris`, { headers: B });
  const verifyKasir = await j("/api/admin/qris", {
    method: "POST",
    headers: K,
    body: JSON.stringify({ orderId: order4.id, action: "verify" }),
  });
  check("Kasir tidak boleh verifikasi (403)", verifyKasir.status === 403);
  const verifyAdmin = await j("/api/admin/qris", {
    method: "POST",
    headers: A,
    body: JSON.stringify({ orderId: order4.id, action: "verify" }),
  });
  check("Admin verifikasi -> lunas", verifyAdmin.status === 200 && verifyAdmin.data.ok === true, verifyAdmin.data.message ?? "");
  const db4 = await db.order.findUnique({ where: { id: order4.id } });
  check("DB: PAID + PREPARING (verifikasi admin)", db4!.paymentStatus === "PAID" && db4!.status === "PREPARING" && db4!.qrisDeclaredAt === null);
  const verifyMidtransLike = await j("/api/admin/qris", {
    method: "POST",
    headers: A,
    body: JSON.stringify({ orderId: order.id, action: "verify" }),
  });
  check("Verifikasi ulang pesanan lunas -> 409", verifyMidtransLike.status === 409);

  // =========================================================
  console.log("\n== H. Pulihkan salah deklarasi (revert) ==");
  const revert = await j("/api/admin/qris", {
    method: "POST",
    headers: A,
    body: JSON.stringify({ orderId: order4.id, action: "revert" }),
  });
  check("Revert OK", revert.status === 200 && revert.data.ok === true);
  const db5 = await db.order.findUnique({ where: { id: order4.id } });
  check(
    "DB: kembali UNPAID + PENDING + paidAt kosong",
    db5!.paymentStatus === "UNPAID" && db5!.status === "PENDING" && db5!.paidAt === null && db5!.qrisDeclaredAt === null
  );

  // =========================================================
  console.log("\n== I. Pengelola QRIS menampilkan transaksi statis ==");
  const mgr = await j("/api/admin/qris", { headers: A });
  check("GET /api/admin/qris OK", mgr.status === 200);
  check("config.statis aktif", mgr.data.config?.statis?.enabled === true, JSON.stringify(mgr.data.config?.statis));
  check("activeProvider statis", mgr.data.config?.activeProvider === "statis");
  const txList = mgr.data.transactions ?? [];
  const t1 = txList.find((t: any) => t.code === order.code);
  const t3 = txList.find((t: any) => t.code === order3.code);
  const t4 = txList.find((t: any) => t.code === order4.code);
  check("Transaksi declare tampil (Lunas + deklarasi)", t1?.paymentStatus === "PAID" && !!t1?.qrisDeclaredAt);
  check("Transaksi webhook tampil (Lunas, tanpa deklarasi)", t3?.paymentStatus === "PAID" && !t3?.qrisDeclaredAt);
  check("Transaksi reverted tampil (Menunggu)", t4?.paymentStatus === "UNPAID" && t4?.status === "PENDING");
  check("Penyedia statis pada baris", t1?.provider === "statis" && t3?.provider === "statis" && t4?.provider === "statis");
  const summary = mgr.data.summary ?? {};
  check("Ringkasan dana masuk > 0", summary.totalMasuk > 0, `totalMasuk=${summary.totalMasuk}`);
  const mgrKasir = await j("/api/admin/qris", { headers: K });
  check("Kasir tidak boleh lihat pengelola (403)", mgrKasir.status === 403);

  // =========================================================
  // Bersih-bersih data uji
  const ids = [order.id, order2.id, order3.id, order4.id].filter(Boolean);
  await db.order.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n${ids.length} pesanan uji dibersihkan.`);
  console.log(failures === 0 ? "\nSEMUA TES LULUS ✓" : `\n${failures} TES GAGAL ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Uji end-to-end SISTEM POIN MEMBER:
 *  1. Login kasir, admin, pelanggan (budi), daftar user baru
 *  2. Kartu member: kode member 8 digit (backfill malas), tier, riwayat
 *  3. Poin TIDAK masuk saat checkout — hanya saat pesanan SELESAI
 *  4. Alur PENDING→PREPARING→READY→COMPLETED: poin masuk (1 poin / Rp 1.000)
 *  5. Idempoten: COMPLETED tidak bisa diulang (transisi ditolak)
 *  6. POS: lookup kode member (scan barcode) → pesanan tertaut ke member → poin masuk
 *  7. Keamanan lookup: pelanggan 403, kode salah 404, kode pendek 400
 *  8. Tukar poin → voucher OTOMATIS (kode PNT-, FIXED, pribadi)
 *  9. Saldo tidak bisa minus; tier tak valid ditolak; tanpa login 401
 * 10. Voucher pribadi: hanya pemilik yang melihat & bisa pakai
 * 11. Voucher hasil tukar benar-benar berfungsi saat checkout (diskon)
 * 12. Bersihkan data uji
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const BASE = "http://localhost:3000";
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
  const pw = "test1234";
  for (const email of ["kasir@agsi.test", "budi@example.com", "admin@agsi.test"]) {
    await db.user.update({ where: { email }, data: { passwordHash: hashPassword(pw) } });
  }
  const budiBefore = await db.user.findUnique({ where: { email: "budi@example.com" } });

  // ==== 1. Login ====
  const kasir = await j("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "kasir@agsi.test", password: pw }) });
  const admin = await j("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@agsi.test", password: pw }) });
  const budi = await j("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "budi@example.com", password: pw }) });
  check("Login kasir, admin, pelanggan", !!kasir.data.token && !!admin.data.token && !!budi.data.token);
  const K = { Authorization: `Bearer ${kasir.data.token}`, "Content-Type": "application/json" };
  const A = { Authorization: `Bearer ${admin.data.token}`, "Content-Type": "application/json" };
  const B = { Authorization: `Bearer ${budi.data.token}`, "Content-Type": "application/json" };

  // ==== 2. Kartu member ====
  const card1 = await j("/api/member/card", { headers: B });
  const code1 = String(card1.data.memberCode ?? "");
  check("Kartu member: kode member 8 digit (backfill malas)", card1.status === 200 && /^\d{8}$/.test(code1), `code=${code1}`);
  check("Kartu member: tier tukar tersedia", Array.isArray(card1.data.tiers) && card1.data.tiers.length >= 4, `tiers=${card1.data.tiers?.length}`);
  check("Kartu member: tanpa login 401", (await j("/api/member/card")).status === 401);

  const prods = await j("/api/products");
  const product = prods.data.products[0];

  const createdOrderIds: string[] = [];
  const createdVoucherIds: string[] = [];

  try {
    // ==== 3. Checkout TIDAK memberi poin ====
    const beforePoints: number = card1.data.points;
    const ord1 = await j("/api/orders", {
      method: "POST", headers: B,
      body: JSON.stringify({ items: [{ productId: product.id, qty: 3 }], type: "DINE_IN", paymentMethod: "CASH" }),
    });
    createdOrderIds.push(ord1.data.order.id);
    const pAfterCheckout = (await j("/api/member/card", { headers: B })).data.points;
    check("Checkout TIDAK langsung memberi poin", pAfterCheckout === beforePoints,
      `sebelum=${beforePoints} sesudah=${pAfterCheckout}`);

    // ==== 4. Selesaikan pesanan → poin masuk ====
    for (const st of ["PREPARING", "READY", "COMPLETED"]) {
      await j(`/api/orders/${ord1.data.order.id}`, { method: "PUT", headers: A, body: JSON.stringify({ status: st }) });
    }
    const expected = Math.floor(ord1.data.order.total / 1000);
    const card2 = await j("/api/member/card", { headers: B });
    check("Poin masuk saat pesanan SELESAI (1 poin / Rp 1.000)",
      card2.data.points === beforePoints + expected,
      `total=${ord1.data.order.total} +${expected} → ${card2.data.points}`);
    const txn = (card2.data.transactions ?? []).find((t: any) => t.description.includes(ord1.data.order.code));
    check("Riwayat mutasi EARN tercatat", !!txn && txn.points === expected && txn.type === "EARN");
    check("Poin disimpan di database user", (await db.user.findUnique({ where: { email: "budi@example.com" } }))!.points === card2.data.points);

    // ==== 5. Idempoten: transisi COMPLETED lagi harus ditolak ====
    const again = await j(`/api/orders/${ord1.data.order.id}`, { method: "PUT", headers: A, body: JSON.stringify({ status: "COMPLETED" }) });
    check("Transisi COMPLETED ganda ditolak (alur status)", again.status === 400, `status=${again.status}`);
    const card3 = await j("/api/member/card", { headers: B });
    check("Poin tidak bertambah ganda", card3.data.points === card2.data.points);

    // ==== 6. POS: scan kode member → pesanan tertaut member ====
    const lookup = await j(`/api/member/lookup?code=${code1}`, { headers: K });
    check("Kasir menemukan member lewat kode", lookup.status === 200 && lookup.data.member?.name === "Budi Santoso", `name=${lookup.data.member?.name}`);
    const ord2 = await j("/api/orders", {
      method: "POST", headers: K,
      body: JSON.stringify({
        items: [{ productId: product.id, qty: 2 }], memberCode: code1,
        type: "DINE_IN", paymentMethod: "CASH", source: "POS",
      }),
    });
    createdOrderIds.push(ord2.data.order.id);
    check("Pesanan POS tertaut ke member (userId)", ord2.status === 200 && ord2.data.order.userId === budiBefore!.id,
      `userId=${ord2.data.order.userId}`);
    check("Nama pelanggan otomatis dari member", ord2.data.order.customerName === "Budi Santoso", `nama=${ord2.data.order.customerName}`);
    for (const st of ["PREPARING", "READY", "COMPLETED"]) {
      await j(`/api/orders/${ord2.data.order.id}`, { method: "PUT", headers: K, body: JSON.stringify({ status: st }) });
    }
    const expected2 = Math.floor(ord2.data.order.total / 1000);
    const card4 = await j("/api/member/card", { headers: B });
    check("Poin pesanan POS (member tertaut) masuk saat selesai",
      card4.data.points === card3.data.points + expected2, `+${expected2} → ${card4.data.points}`);

    // ==== 7. Keamanan lookup ====
    check("Lookup oleh pelanggan ditolak 403", (await j(`/api/member/lookup?code=${code1}`, { headers: B })).status === 403);
    check("Lookup kode salah 404", (await j(`/api/member/lookup?code=00000000`, { headers: K })).status === 404);
    check("Lookup kode pendek 400", (await j(`/api/member/lookup?code=12`, { headers: K })).status === 400);
    const posNoMember = await j("/api/orders", {
      method: "POST", headers: K,
      body: JSON.stringify({
        items: [{ productId: product.id, qty: 1 }], memberCode: "99999999",
        type: "DINE_IN", paymentMethod: "CASH", source: "POS",
      }),
    });
    check("POS dengan kode member salah ditolak 400", posNoMember.status === 400, `status=${posNoMember.status}`);

    // ==== 8. Tukar poin → voucher otomatis ====
    // pastikan saldo cukup & deterministik
    await db.user.update({ where: { id: budiBefore!.id }, data: { points: 300 } });
    const redeem1 = await j("/api/member/redeem", { method: "POST", headers: B, body: JSON.stringify({ tierId: "P250" }) });
    const vCode: string = redeem1.data.voucher?.code ?? "";
    check("Tukar 250 poin → voucher Rp 30.000 otomatis",
      redeem1.status === 200 && /^PNT-[A-Z2-9]{6}$/.test(vCode) && redeem1.data.voucher.value === 30000,
      `kode=${vCode} nilai=${redeem1.data.voucher?.value}`);
    check("Saldo berkurang sesuai poin", redeem1.data.points === 50, `saldo=${redeem1.data.points}`);
    const vRow = await db.voucher.findUnique({ where: { code: vCode } });
    createdVoucherIds.push(vRow!.id);
    check("Voucher pribadi di database (FIXED, kuota 1, ownerId)",
      vRow!.type === "FIXED" && vRow!.quota === 1 && vRow!.ownerId === budiBefore!.id && !!vRow!.expiresAt);
    const redeem2 = await j("/api/member/redeem", { method: "POST", headers: B, body: JSON.stringify({ tierId: "P500" }) });
    check("Poin kurang ditolak 400", redeem2.status === 400 && /belum cukup/i.test(redeem2.data.error ?? ""), `status=${redeem2.status}`);
    const redeem3 = await j("/api/member/redeem", { method: "POST", headers: B, body: JSON.stringify({ tierId: "TIDAKADA" }) });
    check("Tier tak valid ditolak 400", redeem3.status === 400);
    check("Tukar tanpa login 401", (await j("/api/member/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tierId: "P100" }) })).status === 401);

    // ==== 9. Pendaftaran baru otomatis dapat kode member ====
    const reg = await j("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Uji Member", email: "uji.member@agsi.test", password: pw }),
    });
    check("Registrasi → kode member otomatis", /^\d{8}$/.test(String(reg.data.user?.memberCode ?? "")), `code=${reg.data.user?.memberCode}`);
    const T = { Authorization: `Bearer ${reg.data.token}`, "Content-Type": "application/json" };

    // ==== 10. Voucher pribadi hanya milik pemilik ====
    const myList = await j("/api/vouchers", { headers: B });
    check("Pemilik melihat voucher hasil tukar di daftarnya",
      (myList.data.vouchers ?? []).some((v: any) => v.code === vCode));
    const tempList = await j("/api/vouchers", { headers: T });
    check("Akun lain TIDAK melihat voucher pribadi",
      !(tempList.data.vouchers ?? []).some((v: any) => v.code === vCode));
    const applyOther = await j("/api/vouchers/apply", { method: "POST", headers: T, body: JSON.stringify({ code: vCode, subtotal: 100000 }) });
    check("Akun lain ditolak memakai voucher pribadi", applyOther.status === 400 && /bukan milik/i.test(applyOther.data.error ?? ""), `error=${applyOther.data.error}`);

    // ==== 11. Voucher hasil tukar benar-benar berfungsi ====
    const ord3 = await j("/api/orders", {
      method: "POST", headers: B,
      body: JSON.stringify({
        items: [{ productId: product.id, qty: 4 }], type: "TAKEAWAY",
        paymentMethod: "CASH", voucherCode: vCode,
      }),
    });
    createdOrderIds.push(ord3.data.order.id);
    const sub3 = ord3.data.order.subtotal;
    const wantDiscount = Math.min(30000, sub3);
    check("Checkout memakai voucher poin: diskon benar",
      ord3.status === 200 && ord3.data.order.voucherCode === vCode && ord3.data.order.voucherDiscount === wantDiscount,
      `subtotal=${sub3} diskon=${ord3.data.order.voucherDiscount}`);
    const vUsed = await db.voucher.findUnique({ where: { code: vCode } });
    check("Voucher tercatat terpakai (sekali pakai)", vUsed!.usedCount === 1);
    const card5 = await j("/api/member/card", { headers: B });
    const myV = (card5.data.vouchers ?? []).find((v: any) => v.code === vCode);
    check("Kartu member menandai voucher sudah dipakai", myV?.used === true);
    const reapply = await j("/api/vouchers/apply", { method: "POST", headers: B, body: JSON.stringify({ code: vCode, subtotal: 100000 }) });
    check("Voucher terpakai tidak bisa dipakai lagi", reapply.status === 400);
  } finally {
    // ==== 12. Bersihkan ====
    for (const id of createdOrderIds) {
      await db.voucherRedemption.deleteMany({ where: { orderId: id } });
      await db.orderItem.deleteMany({ where: { orderId: id } });
      await db.order.deleteMany({ where: { id } });
    }
    for (const id of createdVoucherIds) {
      await db.voucherRedemption.deleteMany({ where: { voucherId: id } });
      await db.voucher.deleteMany({ where: { id } });
    }
    await db.pointTransaction.deleteMany({ where: { userId: budiBefore!.id } });
    await db.session.deleteMany({ where: { user: { email: "uji.member@agsi.test" } } });
    await db.user.deleteMany({ where: { email: "uji.member@agsi.test" } });
    if (budiBefore) {
      await db.user.update({
        where: { id: budiBefore.id },
        data: { points: budiBefore.points, memberCode: budiBefore.memberCode },
      });
    }
    console.log("  (data uji dibersihkan)");
  }

  console.log("");
  if (failures === 0) {
    console.log(`SEMUA UJI POIN MEMBER LULUS ✓`);
    process.exit(0);
  } else {
    console.error(`${failures} uji GAGAL`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

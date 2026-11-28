// restore-data.mjs — pulihkan data aplikasi AGSI ke database baru (fuchsia-candle).
// Sumber: scripts/seed.ts + seed-vouchers.ts dari branch backup-diverged-main
// (data asli aplikasi Ayam Geprek Sambal Ijo).
// URL DB dibaca dari /tmp/dburl.txt (rahasia tak dicetak).
// Idempoten: aman dijalankan berulang (upsert / skip-if-exists).
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";

process.env.DATABASE_URL = fs.readFileSync("/tmp/dburl.txt", "utf8").trim();
const db = new PrismaClient();

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${hash(pw, salt)}`;
};
const hash = (pw, salt) => scryptSync(pw, salt, 64).toString("hex");
const genCode = (taken) => {
  for (let i = 0; i < 20; i++) {
    const c = String(Math.floor(10000000 + Math.random() * 90000000));
    if (!taken.has(c)) return c;
  }
  throw new Error("gagal buat memberCode");
};

const USERS = [
  { email: "owner@agsi.test", password: "owner123", name: "Musafir Owner", role: "OWNER", phone: null },
  { email: "admin@agsi.test", password: "admin123", name: "Admin AGSI", role: "ADMIN", phone: null },
  { email: "kasir@agsi.test", password: "kasir123", name: "Kasir Satu", role: "CASHIER", phone: null },
  { email: "budi@example.com", password: "user123", name: "Budi Santoso", role: "CUSTOMER", phone: "0857-5555-6666", points: 320 },
];

const PRODUCTS = [
  { name: "Geprek Sambal Ijo", description: "Ayam crispy digeprek sambal ijo cabai hijau asli, level pedas bebas.", price: 18000, category: "Paket Geprek", emoji: "🍗", imageColor: "#16A34A", spicy: 3, popular: true },
  { name: "Geprek Sambal Bawang", description: "Ayam crispy digeprek sambal bawang putih gurih nagih.", price: 17000, category: "Paket Geprek", emoji: "🍗", imageColor: "#F97316", spicy: 2, popular: true },
  { name: "Geprek Mozarella", description: "Ayam geprek lumer keju mozarella, favoritas anak muda.", price: 24000, category: "Paket Geprek", emoji: "🧀", imageColor: "#FB923C", spicy: 1, popular: true },
  { name: "Geprek Telur Asin", description: "Kombinasi geprek + saus telur asin creamy.", price: 23000, category: "Paket Geprek", emoji: "🥚", imageColor: "#F59E0B", spicy: 1 },
  { name: "Paket Komplit Sambal Ijo", description: "Ayam geprek sambal ijo + nasi + es teh manis.", price: 27000, category: "Paket Geprek", emoji: "🍚", imageColor: "#22C55E", spicy: 3, popular: true },
  { name: "Laos Geprek Sambal Ijo", description: "Laos crispy digeprek sambal ijo, tekstur renyah maksimal.", price: 16000, category: "Ayam & Laos", emoji: "🥩", imageColor: "#84CC16", spicy: 3 },
  { name: "Ayam Crispy Polos", description: "Ayam crispy tanpa sambal, cocok untuk anak-anak.", price: 15000, category: "Ayam & Laos", emoji: "🍖", imageColor: "#FDBA74", spicy: 0 },
  { name: "Cemilan Laos Keju", description: "Laos crispy taburan bubuk keju, camilan wajib.", price: 12000, category: "Cemilan", emoji: "🍟", imageColor: "#FACC15", spicy: 0 },
  { name: "Tahu Teman Geprek", description: "Tahu goreng crispy + sambal ijo pencel.", price: 8000, category: "Cemilan", emoji: "🧈", imageColor: "#A3E635", spicy: 2 },
  { name: "Es Teh Manis Jumbo", description: "Es teh manis segar ukuran jumbo 500ml.", price: 5000, category: "Minuman", emoji: "🧊", imageColor: "#34D399", spicy: 0, popular: true },
  { name: "Es Jeruk Peras", description: "Jeruk peras asli tanpa pemanis buatan.", price: 7000, category: "Minuman", emoji: "🍊", imageColor: "#FB923C", spicy: 0 },
  { name: "Teh Tarik Geprek", description: "Teh tarik creamy, pas buat penetrasi pedas.", price: 9000, category: "Minuman", emoji: "🥤", imageColor: "#FDBA74", spicy: 0 },
  { name: "Extra Sambal Ijo", description: "Sambal ijo ekstra pedas buat pecinta pedas.", price: 3000, category: "Topping", emoji: "🌶️", imageColor: "#22C55E", spicy: 5 },
  { name: "Nasi Putih", description: "Nasi putih hangat porsi liberal.", price: 5000, category: "Topping", emoji: "🍚", imageColor: "#FDE68A", spicy: 0 },
];

const VOUCHERS = [
  { code: "GEPREK10", title: "Diskon 10% Semua Menu", description: "Potongan 10% maksimal Rp 10.000, min. belanja Rp 25.000. Sekali pakai per akun.", type: "PERCENT", value: 10, minPurchase: 25000, maxDiscount: 10000, quota: 100 },
  { code: "HEMAT5K", title: "Potongan Rp 5.000", description: "Potongan langsung Rp 5.000 untuk belanja minimal Rp 20.000. Sekali pakai per akun.", type: "FIXED", value: 5000, minPurchase: 20000, maxDiscount: null, quota: 100 },
  { code: "SEKALIPAKAI", title: "Voucher Eksklusif Sekali Pakai", description: "Potongan Rp 15.000 — kode ini benar-benar hanya bisa dipakai SATU kali oleh satu pelanggan tercepat!", type: "FIXED", value: 15000, minPurchase: 30000, maxDiscount: null, quota: 1 },
];

const ORDERS = [
  { ago: 0.2, status: "PREPARING", source: "APP", type: "DELIVERY", customerName: "Budi Santoso", items: [["Geprek Sambal Ijo", 2], ["Es Teh Manis Jumbo", 2]] },
  { ago: 0.4, status: "PENDING", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 4", tableNo: "4", items: [["Paket Komplit Sambal Ijo", 1]] },
  { ago: 0.8, status: "COMPLETED", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 2", tableNo: "2", items: [["Geprek Mozarella", 1], ["Es Teh Manis Jumbo", 1]] },
  { ago: 1.2, status: "COMPLETED", source: "APP", type: "TAKEAWAY", customerName: "Budi Santoso", items: [["Geprek Sambal Ijo", 1], ["Es Teh Manis Jumbo", 1]] },
  { ago: 2.1, status: "COMPLETED", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 1", tableNo: "1", items: [["Geprek Sambal Ijo", 3]] },
  { ago: 3.4, status: "CANCELLED", source: "APP", type: "DELIVERY", customerName: "Siti", items: [["Geprek Mozarella", 1]] },
  { ago: 4.2, status: "COMPLETED", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 5", tableNo: "5", items: [["Paket Komplit Sambal Ijo", 2], ["Es Teh Manis Jumbo", 2]] },
  { ago: 5.5, status: "COMPLETED", source: "APP", type: "DELIVERY", customerName: "Budi Santoso", items: [["Geprek Sambal Ijo", 2], ["Es Teh Manis Jumbo", 1]] },
  { ago: 6.3, status: "COMPLETED", source: "POS", type: "TAKEAWAY", customerName: "Walk-in Takeaway", items: [["Geprek Sambal Ijo", 1], ["Es Teh Manis Jumbo", 1]] },
];

async function main() {
  // ---- [1] Users ----
  const taken = new Set((await db.user.findMany({ select: { memberCode: true } })).map((u) => u.memberCode).filter(Boolean));
  for (const u of USERS) {
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, phone: u.phone, passwordHash: hashPassword(u.password) },
      create: { email: u.email, name: u.name, role: u.role, phone: u.phone, points: u.points ?? 0, passwordHash: hashPassword(u.password), memberCode: u.role === "CUSTOMER" ? genCode(taken) : null },
    });
    console.log(`✓ user: ${u.email} (${u.role})`);
  }
  const adminOld = await db.user.findUnique({ where: { email: "admin@agsi.co.id" } });
  if (adminOld) { await db.user.delete({ where: { id: adminOld.id } }); console.log("– hapus admin sementara admin@agsi.co.id (digantukan staf seed)"); }

  // ---- [2] Products ----
  for (const p of PRODUCTS) {
    const ex = await db.product.findFirst({ where: { name: p.name } });
    if (!ex) {
      await db.product.create({ data: { ...p, available: true, popular: p.popular ?? false } });
      console.log(`+ produk: ${p.name} (Rp ${p.price.toLocaleString("id")})`);
    } else console.log(`↷ produk sudah ada: ${p.name}`);
  }

  // ---- [3] Vouchers ----
  for (const v of VOUCHERS) {
    const ex = await db.voucher.findUnique({ where: { code: v.code } });
    if (!ex) { await db.voucher.create({ data: v }); console.log(`+ voucher: ${v.code}`); }
    else console.log(`↷ voucher sudah ada: ${v.code}`);
  }

  // ---- [4] Sample orders ----
  if ((await db.order.count()) === 0) {
    const budi = await db.user.findUnique({ where: { email: "budi@example.com" } });
    const byName = Object.fromEntries((await db.product.findMany()).map((p) => [p.name, p]));
    const now = Date.now(), day = 86400000;
    let seq = 1;
    for (const s of ORDERS) {
      const items = s.items.map(([n, q]) => ({ p: byName[n], n, q }));
      if (items.some((i) => !i.p)) { console.log(`! lewati order ${s.customerName}: produk tak ditemukan`); continue; }
      const subtotal = items.reduce((sum, i) => sum + i.p.price * i.q, 0);
      const createdAt = new Date(now - s.ago * day);
      const code = `AGSI-${createdAt.getFullYear()}${String(createdAt.getMonth() + 1).padStart(2, "0")}${String(createdAt.getDate()).padStart(2, "0")}-${String(seq).padStart(3, "0")}`;
      seq++;
      await db.order.create({
        data: {
          code, userId: s.customerName === "Budi Santoso" && budi ? budi.id : null,
          customerName: s.customerName, type: s.type, tableNo: s.tableNo ?? null, status: s.status,
          paymentMethod: "CASH", source: s.source, subtotal, serviceFee: 0, total: subtotal,
          createdAt, updatedAt: createdAt,
          items: { create: items.map((i) => ({ productId: i.p.id, name: i.p.name, emoji: i.p.emoji, price: i.p.price, qty: i.q })) },
        },
      });
    }
    console.log(`+ ${seq - 1} pesanan contoh`);
  } else console.log("↷ order sudah ada, lewati");

  // ---- [5] StoreSetting (baris id=main) ----
  const settings = await db.storeSetting.findUnique({ where: { id: "main" } });
  const defaults = {
    bannerEnabled: true, bannerTitle: "Promo Spesial Hari Ini", bannerText: "Diskon spesial menu favorit — buruan pesan sebelum kehabisan!",
    promoStripEnabled: true, promoStripBadge: "PROMO", promoStripTitle: "Promo Geprek", promoStripText: "Paket Komplit Sambal Ijo cuma Rp 27.000!",
    deliveryEnabled: true, qrisEnabled: true, ewalletEnabled: true,
  };
  if (!settings) {
    await db.storeSetting.create({ data: { id: "main", ...defaults } });
    console.log("+ StoreSetting id=main dibuat (banner & promo aktif)");
  } else console.log("↷ StoreSetting sudah ada");

  // ---- ringkasan ----
  const c = {
    user: await db.user.count(), product: await db.product.count(),
    voucher: await db.voucher.count(), order: await db.order.count(),
    storeSetting: await db.storeSetting.count(),
  };
  console.log("\n=== RINGKASAN ===");
  for (const [k, v] of Object.entries(c)) console.log(`  ${k}: ${v}`);
}

main()
  .catch((e) => { console.error("✗ gagal:", e.message); process.exit(1); })
  .finally(() => db.$disconnect());

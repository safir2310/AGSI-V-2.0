import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  console.log("Seeding database AYAM GEPREK SAMBAL IJO...");

  // Users
  const users = [
    { email: "admin@agsi.test", password: "admin123", name: "Bu Rina (Owner)", role: "OWNER", phone: "0812-1111-2222" },
    { email: "kasir@agsi.test", password: "kasir123", name: "Dika (Kasir)", role: "CASHIER", phone: "0813-3333-4444" },
    { email: "budi@example.com", password: "user123", name: "Budi Santoso", role: "CUSTOMER", phone: "0857-5555-6666", points: 120 },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, phone: u.phone },
      create: {
        email: u.email,
        passwordHash: hashPassword(u.password),
        name: u.name,
        role: u.role,
        phone: u.phone,
        points: u.points ?? 0,
      },
    });
  }
  console.log("Users seeded:", users.map((u) => u.email).join(", "));

  // Products
  const products: Array<{
    name: string; description: string; price: number; category: string;
    emoji: string; imageColor: string; spicy: number; popular?: boolean;
  }> = [
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

  for (const p of products) {
    const existing = await db.product.findFirst({ where: { name: p.name } });
    if (!existing) {
      await db.product.create({
        data: { ...p, available: true, popular: p.popular ?? false },
      });
    }
  }
  console.log(`Products seeded: ${products.length} items`);

  // Sample orders (beberapa hari terakhir untuk laporan)
  const budi = await db.user.findUnique({ where: { email: "budi@example.com" } });
  const geprekIjo = await db.product.findFirst({ where: { name: "Geprek Sambal Ijo" } });
  const paketKomplit = await db.product.findFirst({ where: { name: "Paket Komplit Sambal Ijo" } });
  const mozarella = await db.product.findFirst({ where: { name: "Geprek Mozarella" } });
  const esteh = await db.product.findFirst({ where: { name: "Es Teh Manis Jumbo" } });

  const existingOrders = await db.order.count();
  if (existingOrders === 0) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const samples: Array<{
      ago: number; status: string; source: string; type: string;
      customerName: string; tableNo?: string; items: Array<{ pid?: string; name: string; emoji: string; price: number; qty: number }>;
    }> = [
      { ago: 0.2 * day, status: "PREPARING", source: "APP", type: "DELIVERY", customerName: "Budi Santoso", items: [ { pid: geprekIjo?.id, name: "Geprek Sambal Ijo", emoji: "🍗", price: 18000, qty: 2 }, { pid: esteh?.id, name: "Es Teh Manis Jumbo", emoji: "🧊", price: 5000, qty: 2 } ] },
      { ago: 0.4 * day, status: "PENDING", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 4", tableNo: "4", items: [ { pid: paketKomplit?.id, name: "Paket Komplit Sambal Ijo", emoji: "🍚", price: 27000, qty: 1 } ] },
      { ago: 0.8 * day, status: "COMPLETED", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 2", tableNo: "2", items: [ { pid: mozarella?.id, name: "Geprek Mozarella", emoji: "🧀", price: 24000, qty: 1 }, { pid: esteh?.id, name: "Es Teh Manis Jumbo", emoji: "🧊", price: 5000, qty: 1 } ] },
      { ago: 1.2 * day, status: "COMPLETED", source: "APP", type: "TAKEAWAY", customerName: "Budi Santoso", items: [ { pid: geprekIjo?.id, name: "Geprek Sambal Ijo", emoji: "🍗", price: 18000, qty: 1 }, { pid: esteh?.id, name: "Es Teh Manis Jumbo", emoji: "🧊", price: 5000, qty: 1 } ] },
      { ago: 2.1 * day, status: "COMPLETED", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 1", tableNo: "1", items: [ { pid: geprekIjo?.id, name: "Geprek Sambal Ijo", emoji: "🍗", price: 18000, qty: 3 } ] },
      { ago: 3.4 * day, status: "CANCELLED", source: "APP", type: "DELIVERY", customerName: "Siti", items: [ { pid: mozarella?.id, name: "Geprek Mozarella", emoji: "🧀", price: 24000, qty: 1 } ] },
      { ago: 4.2 * day, status: "COMPLETED", source: "POS", type: "DINE_IN", customerName: "Walk-in Meja 5", tableNo: "5", items: [ { pid: paketKomplit?.id, name: "Paket Komplit Sambal Ijo", emoji: "🍚", price: 27000, qty: 2 }, { pid: esteh?.id, name: "Es Teh Manis Jumbo", emoji: "🧊", price: 5000, qty: 2 } ] },
      { ago: 5.5 * day, status: "COMPLETED", source: "APP", type: "DELIVERY", customerName: "Budi Santoso", items: [ { pid: geprekIjo?.id, name: "Geprek Sambal Ijo", emoji: "🍗", price: 18000, qty: 2 }, { pid: esteh?.id, name: "Es Teh Manis Jumbo", emoji: "🧊", price: 5000, qty: 1 } ] },
      { ago: 6.3 * day, status: "COMPLETED", source: "POS", type: "TAKEAWAY", customerName: "Walk-in Takeaway", items: [ { pid: geprekIjo?.id, name: "Geprek Sambal Ijo", emoji: "🍗", price: 18000, qty: 1 }, { pid: esteh?.id, name: "Es Teh Manis Jumbo", emoji: "🧊", price: 5000, qty: 1 } ] },
    ];

    let seq = 1;
    for (const s of samples) {
      const subtotal = s.items.reduce((sum, it) => sum + it.price * it.qty, 0);
      const serviceFee = 0;
      const createdAt = new Date(now - s.ago);
      const code = `AGSI-${createdAt.getFullYear()}${String(createdAt.getMonth() + 1).padStart(2, "0")}${String(createdAt.getDate()).padStart(2, "0")}-${String(seq).padStart(3, "0")}`;
      seq++;
      await db.order.create({
        data: {
          code,
          userId: s.customerName === "Budi Santoso" && budi ? budi.id : null,
          customerName: s.customerName,
          type: s.type,
          tableNo: s.tableNo,
          status: s.status,
          paymentMethod: "CASH",
          source: s.source,
          subtotal,
          serviceFee,
          total: subtotal + serviceFee,
          createdAt,
          updatedAt: createdAt,
          items: {
            create: s.items.map((it) => ({
              productId: it.pid ?? null,
              name: it.name,
              emoji: it.emoji,
              price: it.price,
              qty: it.qty,
            })),
          },
        },
      });
    }
    console.log(`Sample orders seeded: ${samples.length}`);
  }

  console.log("Seed selesai!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

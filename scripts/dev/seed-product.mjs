/**
 * seed-product.mjs — seduh satu produk uji ke DB lokal e2e (sqlite) lewat
 * Prisma (format DateTime dijamin sesuai — insert SQL mentah bikin P2023).
 * DATABASE_URL harus menunjuk db/e2e-test.db.
 * Jalankan: DATABASE_URL="file:db/e2e-test.db" node scripts/dev/seed-product.mjs
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
await db.product.upsert({
  where: { id: "p-geprek-ujian" },
  update: {},
  create: {
    id: "p-geprek-ujian",
    name: "Ayam Geprek Sambal Ijo",
    description: "Geprek sambal ijo level 1-5 + nasi",
    price: 15000,
    category: "Makanan",
    emoji: "🍗",
    spicy: 1,
    available: true,
    popular: true,
  },
});
console.log("produk:", await db.product.findMany({ select: { id: true, name: true, price: true } }));
await db.$disconnect();

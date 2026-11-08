/**
 * Ambil pesanan QRIS terbaru milik user uji (untuk E2E).
 * Pakai: bun scripts/get-latest-order.ts [email]
 */
import { PrismaClient } from "@prisma/client";

const email = process.argv[2] ?? "uji-popup-qris@test.local";
const db = new PrismaClient();

const user = await db.user.findUnique({ where: { email } });
if (!user) {
  console.log("USER_NOT_FOUND");
} else {
  const orders = await db.order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      code: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      total: true,
      createdAt: true,
    },
  });
  console.log(JSON.stringify(orders, null, 2));
}

await db.$disconnect();

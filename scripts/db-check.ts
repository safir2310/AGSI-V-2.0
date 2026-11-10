/** Cek isi DB: user, produk, pesanan QRIS terakhir */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const users = await db.user.findMany({ select: { id: true, email: true, role: true, name: true }, take: 10 });
console.log("USERS:", JSON.stringify(users, null, 1));
const products = await db.product.findMany({ select: { id: true, name: true, price: true, available: true }, take: 5 });
console.log("PRODUCTS:", JSON.stringify(products, null, 1));
const orders = await db.order.count();
console.log("ORDER COUNT:", orders);
await db.$disconnect();

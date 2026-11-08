import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const rows = await db.order.findMany({
  orderBy: { createdAt: "desc" },
  take: 8,
  select: {
    code: true,
    customerName: true,
    phone: true,
    userId: true,
    type: true,
    status: true,
    paymentMethod: true,
    paymentStatus: true,
    total: true,
    user: { select: { phone: true, name: true } },
  },
});
for (const r of rows) {
  console.log(
    [r.code, r.customerName, `hp=${r.phone}`, `akun=${r.user?.phone ?? "-"}`, r.type, r.status, r.paymentMethod, r.paymentStatus, r.total].join(" | ")
  );
}
const noPhone = await db.order.count({ where: { phone: null } });
console.log("order tanpa phone:", noPhone);
await db.$disconnect();

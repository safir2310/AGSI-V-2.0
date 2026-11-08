// List a few users for login smoke test (production validation)
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const users = await db.user.findMany({
  select: { email: true, name: true, role: true },
  take: 5,
  orderBy: { createdAt: 'asc' },
})
console.log(JSON.stringify(users, null, 2))
await db.$disconnect()

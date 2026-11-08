import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Catatan: 'query' TIDAK diaktifkan — log query membuat dev.log terus
    // berubah dan memicu siklus Fast Refresh HMR saat aplikasi polling.
    log: ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
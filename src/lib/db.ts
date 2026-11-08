import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Koneksi database aplikasi: Prisma Postgres (db.prisma.io) via DATABASE_URL
 * di .env — koneksi Postgres standar (wire protocol + sslmode=require),
 * tanpa driver adapter. Panduan deploy: PRISMA_SETUP.md.
 */
function createDb(): PrismaClient {
  return new PrismaClient({ log: ['warn', 'error'] })
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Koneksi database aplikasi:
 * - TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) tersedia → Turso / libSQL di cloud
 *   (dipakai di sandbox ini & saat deploy Vercel) lewat driver adapter resmi
 *   Prisma @prisma/adapter-libsql.
 * - Tidak tersedia → SQLite lokal file db/custom.db (pengembangan tanpa
 *   kredensial Turso; juga dipakai Prisma CLI lewat DATABASE_URL).
 */
function createDb(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  if (tursoUrl) {
    // Adapter 6.x berbentuk factory: terima CONFIG libsql, bukan instance client.
    return new PrismaClient({
      adapter: new PrismaLibSQL({
        url: tursoUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
      // Catatan: 'query' TIDAK diaktifkan — log query membuat dev.log terus
      // berubah dan memicu siklus Fast Refresh HMR saat aplikasi polling.
      log: ['warn', 'error'],
    })
  }
  return new PrismaClient({ log: ['warn', 'error'] })
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

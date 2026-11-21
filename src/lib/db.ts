import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Koneksi database aplikasi — TURSO (libSQL/SQLite) via driver adapter:
 *   DATABASE_URL = libsql://database-pink-kettle….turso.io (+ TURSO_AUTH_TOKEN)
 * Kode aplikasi 100% tak berubah — tetap PrismaClient biasa; hanya lapisan
 * koneksi yang diganti adapter (v6: konfigurasi dilempar langsung, adapter
 * membuat client-nya sendiri). Bila DATABASE_URL bukan libsql:// (mis. dev
 * lokal file:), pakai jalur standar Prisma tanpa adapter.
 */
function createDb(): PrismaClient {
  const url = process.env.DATABASE_URL ?? ''
  if (url.startsWith('libsql://')) {
    const adapter = new PrismaLibSQL({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    })
    return new PrismaClient({ adapter, log: ['warn', 'error'] })
  }
  // file: SQLite lokal (dev) — engine standar
  return new PrismaClient({ log: ['warn', 'error'] })
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

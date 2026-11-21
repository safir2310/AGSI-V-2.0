import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Koneksi database aplikasi — SUPABASE (Postgres, ap-southeast-1):
 *   DATABASE_URL = postgres://…pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true
 * PrismaClient standar (tanpa driver adapter) via wire protocol Postgres +
 * pooler pgbouncer utk serverless. Era sebelumnya: Turso/libSQL via
 * @prisma/adapter-libsql (git e28f597), era awal: Prisma Postgres.
 */
function createDb(): PrismaClient {
  return new PrismaClient({ log: ['warn', 'error'] })
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

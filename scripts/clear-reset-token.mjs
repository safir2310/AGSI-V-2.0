// Hapus hanya baris PasswordReset (token OTP) untuk satu email — user TETAP ADA
import { PrismaClient } from "@prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"

const envFile = resolve(process.cwd(), ".env")
const m = readFileSync(envFile, "utf8").match(/^DATABASE_URL="?(.*?)"?$/m)
if (m?.[1]) process.env.DATABASE_URL = m[1]

const db = new PrismaClient()
const email = process.argv[2] ?? ""
const r = await db.passwordReset.deleteMany({ where: { email } })
console.log(`PasswordReset dihapus: ${r.count} baris (${email || "SEMUA"}) — user tidak diubah.`)
await db.$disconnect()

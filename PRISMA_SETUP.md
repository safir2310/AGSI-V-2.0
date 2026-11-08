# DATABASE: PRISMA POSTGRES (db.prisma.io) — AGSI POS

Aplikasi AGSI POS kini terhubung ke **Prisma Postgres** (Postgres cloud dari
Prisma, siap deploy ke Vercel). Panduan ini menjelaskan konfigurasi, cara
deploy, dan rollback bila perlu.

---

## 1. Konfigurasi Aktif

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

`.env` (lokal) — ketiga variabel bernilai sama (koneksi Postgres standar):

```env
DATABASE_URL="postgres://<user>:<password>@db.prisma.io:5432/postgres?sslmode=require"
PRISMA_DATABASE_URL="(sama dengan DATABASE_URL)"
POSTGRES_URL="(sama dengan DATABASE_URL)"
```

- `db.prisma.io:5432` memakai **wire protocol Postgres standar** → tanpa
  driver adapter. `src/lib/db.ts` kini cukup `new PrismaClient()`.
- Adapter Turso (`@prisma/adapter-libsql`, `@libsql/client`) tidak lagi dipakai
  aplikasi; kredensial `TURSO_*` masih tersimpan di `.env` hanya sebagai
  cadangan rollback.

## 2. Deploy ke Vercel

1. Push repo (sudah di GitHub `safir2310/AGSI-V-2.0`).
2. Di Vercel → Project → **Settings ▸ Environment Variables**, isi untuk
   Production (+ Preview bila perlu):

   | Nama | Nilai |
   | --- | --- |
   | `DATABASE_URL` | koneksi Prisma Postgres (sama dengan `.env`) |
   | `PRISMA_DATABASE_URL` | sama |
   | `POSTGRES_URL` | sama |

   Kredensial lain yang sudah dipakai aplikasi juga diisi di sini:
   `FIREBASE_*` (push), `RESEND_API_KEY` (email), dst.
3. Deploy. **Tidak perlu** `prisma db push` saat build — tabel sudah dibuat.
4. Bila perlu mengubah schema di kemudian hari: ubah `prisma/schema.prisma`
   lalu jalankan `bunx prisma db push` dari lokal (atau CI) — koneksi dari
   laptop ke db.prisma.io sudah terbukti jalan.

## 3. Perintah Prisma (dari laptop)

```bash
# catatan: shell sandbox mengekspor DATABASE_URL lama — selalu override:
DATABASE_URL="$(grep '^DATABASE_URL' .env | cut -d'"' -f2)" bunx prisma db push
DATABASE_URL="$(grep '^DATABASE_URL' .env | cut -d'"' -f2)" bunx prisma studio
```

## 4. Data — Sudah Termigrasi Penuh

Snapshot migrasi (Turso → Prisma Postgres, upsert by id, konversi tipe
otomatis): **16 tabel / 416 baris** — users (7, termasuk admin), produk (14),
pesanan (71) + item (99), voucher (6), poin (24), chat CS (2 utas/9 pesanan),
sesi login, kredensial biometrik, pengaturan toko, token push.

Skrip yang dipakai (bisa dijalankan ulang bila perlu sinkron ulang):

| Skrip | Fungsi |
| --- | --- |
| `scripts/export-turso.mjs` | Ekspor Turso → `db/export-turso.json` (backup) |
| `scripts/sync-turso-to-pg.mjs` | Upsert Turso → Prisma Postgres (idempoten) |
| `scripts/count-db.mjs` | Hitung baris per tabel di database aktif |

> Setelah aplikasi berjalan di Prisma Postgres, Turso **tidak lagi menerima
> tulisan**. Jalankan `sync-turso-to-pg.mjs` hanya bila belum yakin semua
> perubahan terakhir tersalin.

## 5. Rollback ke Turso (darurat)

1. `cp prisma/schema.prisma.sqlite.bak prisma/schema.prisma`
   (provider sqlite + driverAdapters).
2. Pulihkan `src/lib/db.ts` versi lama (cabang Turso dengan
   `PrismaLibSQL`) — ada di git history / `db/` backup.
3. `cp .env.sqlite.bak .env` → `bunx prisma db push --skip-generate` tidak
   perlu; cukup `bunx prisma generate`.
4. Restart server. Data maksimum yang hilang = tulisan selama periode
   di Prisma Postgres (jalankan `sync-turso-to-pg.mjs` terbalik bila perlu).

## 6. Checklist Verifikasi (sudah dilakukan 2026-11-08)

- [x] `bunx prisma db push` → "The database is already in sync"
- [x] Sinkron 16 tabel (1 session delta dibuat, 415 baris disegarkan)
- [x] Server dev hidup di postgres: homepage 200, `/api/products` = 14 menu
- [x] Uji tulis: register user uji → memberCode unik terbuat → hapus ulang
- [x] Push FCM tetap aktif (`/api/push/config` → configured true)
- [x] `tsc` 0 error di `src/`

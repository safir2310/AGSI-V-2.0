#!/usr/bin/env python3
"""Hasilkan rute perbaikan sementara src/app/api/admin/repair-schema/route.ts
dengan SEMUA patch SQL (001-010 + 011-user-columns) TER-EMBED — supaya tidak
bergantung pada folder prisma/sql yang mungkin tak ikut dalam bundle
standalone. Jalankan sekali: python3 scripts/gen-repair-route.py"""
import json
import pathlib

ROOT = pathlib.Path("/home/z/my-project")
SQL_DIR = ROOT / "prisma" / "sql"
OUT = ROOT / "src/app/api/admin/repair-schema/route.ts"
KEY = "sN1Qla3lN700ZuXImU2YpBz5tMVu8qQZ"

USER_COLUMNS_SQL = """-- ===== [011] KOLOM MODEL "User" TIDAK TERCAKUP PATCH 001-010 =====
-- Model User (prisma/schema.prisma) memuat kolom persetujuan legal & kode
-- member yang tidak punya file patch SQL sendiri. MURNI ADITIF & IDEMPOTENT.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "memberCode" TEXT,
  ADD COLUMN IF NOT EXISTS "dataConsentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dataConsentVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "appTermsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "appTermsVersion" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_memberCode_key" ON "User"("memberCode");
"""

files = {"011-user-columns.sql": USER_COLUMNS_SQL}
for p in sorted(SQL_DIR.glob("*.sql")):
    files[p.name] = p.read_text(encoding="utf-8")

ROUTE = """/**
 * [SEMENTARA — dihapus setelah perbaikan] Rute perbaikan skema darurat.
 *
 * Latar: build Vercel gagal menjangkau db.prisma.io (P1001) sehingga langkah
 * apply-pg-schema-extras dilewati; tabel "User" di DB produksi ternyata tidak
 * sinkron dgn model Prisma (findUnique login gagal 500, sementara raw SQL
 * /api/settings sehat). Rute ini menjalankan PATCH SQL ADITIF & IDEMPOTEN
 * (semua prisma/sql/*.sql + 011-user-columns) lewat RUNTIME yang terbukti
 * sehat. Seluruh isi SQL TER-EMBED agar tak bergantung bundle standalone.
 *
 * GET  /api/admin/repair-schema?key=…  → daftar kolom aktual tabel "User"
 * POST /api/admin/repair-schema?key=…  → terapkan semua patch idempoten +
 *                                        daftar kolom terbaru. Aman berulang.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const KEY = "__KEY__";

const EXPECTED_USER_COLUMNS = [
  "id",
  "email",
  "passwordHash",
  "name",
  "phone",
  "role",
  "points",
  "memberCode",
  "dataConsentAt",
  "dataConsentVersion",
  "appTermsAt",
  "appTermsVersion",
  "createdAt",
  "updatedAt",
];

const SQL_FILES: Record<string, string> = __SQL__;

/** Pisahkan isi SQL menjadi pernyataan tunggal pada ';' di luar blok $$ */
function splitStatements(text: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let inDollar = false;
  for (const rawLine of text.split("\\n")) {
    const line = rawLine.replace(/--.*$/, "");
    buf += line + "\\n";
    const t = line.trim();
    if (/\\$\\$\\s*;?\\s*$/.test(t)) inDollar = !inDollar;
    if (!inDollar && buf.trim().endsWith(";")) {
      const s = buf.trim().slice(0, -1).trim();
      if (s) statements.push(s);
      buf = "";
    }
  }
  const rest = buf.trim();
  if (rest) statements.push(rest);
  return statements;
}

async function userColumns() {
  return db.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'User' ORDER BY ordinal_position`,
  );
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const cols = await userColumns();
    const have = new Set(cols.map((c) => c.column_name));
    const missing = EXPECTED_USER_COLUMNS.filter((c) => !have.has(c));
    return NextResponse.json({ columns: cols, missing });
  } catch (e) {
    return NextResponse.json(
      { error: String((e as Error)?.message ?? e).slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const applied: { file: string; statements: number; skipped?: string[] }[] = [];
  try {
    for (const [file, text] of Object.entries(SQL_FILES)) {
      const skipped: string[] = [];
      const statements = splitStatements(text);
      for (const st of statements) {
        try {
          await db.$executeRawUnsafe(st);
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          if (/already exists|duplicate/i.test(msg)) {
            skipped.push(msg.slice(0, 120));
            continue;
          }
          throw err;
        }
      }
      applied.push({ file, statements: statements.length, skipped });
    }
    const cols = await userColumns();
    const have = new Set(cols.map((c) => c.column_name));
    const missing = EXPECTED_USER_COLUMNS.filter((c) => !have.has(c));
    return NextResponse.json({ ok: true, applied, columns: cols, missing });
  } catch (e) {
    return NextResponse.json(
      { applied, error: String((e as Error)?.message ?? e).slice(0, 500) },
      { status: 500 },
    );
  }
}
"""

route = ROUTE.replace("__KEY__", KEY).replace("__SQL__", json.dumps(files, indent=2))
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(route, encoding="utf-8")
print(f"OK → {OUT} ({len(route)} bytes, {len(files)} file SQL ter-embed)")

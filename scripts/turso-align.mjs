/**
 * turso-align.mjs — selaraskan skema Turso (libSQL) dengan prisma/schema.prisma
 * (provider sqlite). IDEMPOTEN & ADITIF — tidak pernah menghapus/mengubah
 * kolom yang sudah ada, tidak menulis data.
 *
 * Sumber kebenaran DDL: prisma/sql/sqlite-schema.sql (hasil
 * `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`).
 *
 * Pemakaian: node scripts/turso-align.mjs
 *   (butuh scripts/.turso-token; DATABASE_URL libsql opsional override)
 */
import { readFileSync } from "node:fs";

const TURSO_URL =
  process.env.DATABASE_URL?.startsWith("libsql://")
    ? process.env.DATABASE_URL
    : "libsql://database-pink-kettle-vercel-icfg-jgyaeywkuedf7avmnam1bgxs.aws-us-east-1.turso.io";
const TOKEN = process.env.TURSO_AUTH_TOKEN || readFileSync("/home/z/my-project/scripts/.turso-token", "utf8").trim();

const ddl = readFileSync("/home/z/my-project/prisma/sql/sqlite-schema.sql", "utf8");

// ---- parse DDL → spesifikasi per tabel ----
const tables = {}; // name -> { create, cols: [{name, def}], notnullNodefault: [] }
const re = /CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g;
for (const m of ddl.matchAll(re)) {
  const name = m[1];
  const body = m[2];
  const cols = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith('"')) continue; // lewati CONSTRAINT
    const cm = t.match(/^"([^"]+)"\s+(.+?)(?:,\s*)?$/);
    if (!cm) continue;
    const def = cm[2].replace(/\s*(?:,\s*)?$/, "").replace(/PRIMARY KEY/, "").trim();
    cols.push({ name: cm[1], def });
  }
  tables[name] = { create: m[0].replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"), cols };
}
const indexes = ddl
  .split("\n")
  .filter((l) => /^CREATE (UNIQUE )?INDEX/.test(l.trim()))
  .map((l) =>
    l
      .trim()
      .replace(/;$/, "")
      .replace(/^CREATE (UNIQUE INDEX|INDEX) /, (m0) =>
        m0.includes("UNIQUE") ? "CREATE UNIQUE INDEX IF NOT EXISTS " : "CREATE INDEX IF NOT EXISTS "
      )
  );

const { createClient } = await import("@libsql/client");
const db = createClient({ url: TURSO_URL, authToken: TOKEN });

const existing = new Set(
  (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_libsql%'")).rows.map((r) => r.name)
);

let created = 0, altered = 0, idx = 0, problems = 0;

// 1) buat tabel yang belum ada
for (const [name, spec] of Object.entries(tables)) {
  if (!existing.has(name)) {
    await db.execute(spec.create);
    console.log(`CREATE TABLE ${name} (${spec.cols.length} kolom)`);
    created++;
  }
}

// 2) tambahkan kolom yang kurang (hanya nullable / ber-default — aman utk tabel berisi data)
for (const [name, spec] of Object.entries(tables)) {
  if (!existing.has(name)) continue; // baru dibuat — sudah lengkap
  const cols = (await db.execute(`PRAGMA table_info("${name}")`)).rows.map((r) => r.name);
  const missing = spec.cols.filter((c) => !cols.includes(c.name));
  for (const c of missing) {
    const notnull = /NOT NULL/i.test(c.def);
    const hasDefault = /DEFAULT /i.test(c.def);
    if (notnull && !hasDefault && !/PRIMARY KEY/i.test(c.def)) {
      console.log(`LEWATI ${name}.${c.name} — NOT NULL tanpa default tidak bisa ADD COLUMN aman`);
      problems++;
      continue;
    }
    const sql = `ALTER TABLE "${name}" ADD COLUMN "${c.name}" ${c.def}`;
    await db.execute(sql);
    console.log(`ALTER TABLE ${name} ADD ${c.name} ${c.def.replace(/NOT NULL|DEFAULT |CURRENT_TIMESTAMP|true|false|'[^\']*'/gi, (s) => s).slice(0, 60)}`);
    altered++;
  }
}

// 3) indeks (IF NOT EXISTS → idempoten)
for (const ix of indexes) {
  try {
    await db.execute(ix);
    idx++;
  } catch (e) {
    const msg = String(e.message);
    if (!/already exists/i.test(msg)) { console.log(`INDEKS GAGAL: ${ix.slice(0, 80)} — ${msg.slice(0, 120)}`); problems++; }
  }
}

// 4) verifikasi akhir: bandingkan kolom
console.log("\n===== VERIFIKASI =====");
let allOk = true;
for (const [name, spec] of Object.entries(tables)) {
  const cols = (await db.execute(`PRAGMA table_info("${name}")`)).rows.map((r) => r.name);
  const missing = spec.cols.filter((c) => !cols.includes(c.name)).map((c) => c.name);
  if (missing.length) { console.log(`  ${name}: MASIH KURANG ${missing.join(",")}`); allOk = false; }
  else console.log(`  ${name.padEnd(22)} OK (${cols.length} kolom)`);
}
console.log(`\nHasil: tabel baru=${created}, kolom ditambah=${altered}, indeks diproses=${idx}, masalah=${problems}`);
console.log(allOk && problems === 0 ? "✓ SKEMA TURSO SELARAS DENGAN SCHEMA.PRISMA" : "✗ MASIH ADA SELISIH — periksa output di atas");
process.exit(allOk && problems === 0 ? 0 : 1);

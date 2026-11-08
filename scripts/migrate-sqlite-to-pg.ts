/**
 * Migrasi data: SQLite lokal (db/custom.db) → Prisma Postgres (db.prisma.io).
 * Baca tiap tabel via bun:sqlite (readonly), konversi tipe generik berdasarkan
 * DMMF Prisma, lalu createMany ke Postgres sesuai urutan foreign key.
 * Pakai: set -a; . ./.env; set +a; bun scripts/migrate-sqlite-to-pg.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { Database } from "bun:sqlite";

const pg = new PrismaClient();
const lite = new Database("db/custom.db", { readonly: true });

/** Urutan insert: tabel tanpa FK dulu, lalu mengikuti relasi */
const ORDER: Array<[string, string]> = [
  ["StoreSetting", "storeSetting"],
  ["User", "user"],
  ["Product", "product"],
  ["PasswordReset", "passwordReset"],
  ["PushToken", "pushToken"],
  ["ChatThread", "chatThread"],
  ["ChatMessage", "chatMessage"],
  ["Session", "session"],
  ["Order", "order"],
  ["OrderItem", "orderItem"],
  ["Voucher", "voucher"],
  ["VoucherRedemption", "voucherRedemption"],
  ["PointTransaction", "pointTransaction"],
  ["BiometricCredential", "biometricCredential"],
  ["BiometricChallenge", "biometricChallenge"],
  ["QrisSandboxTrx", "qrisSandboxTrx"],
];

/** Peta nama field → tipe Prisma, dari DMMF client ter-generate */
const fieldTypes = new Map<string, Map<string, string>>();
for (const m of Prisma.dmmf.datamodel.models) {
  const map = new Map<string, string>();
  for (const f of m.fields) map.set(f.name, f.type);
  fieldTypes.set(m.name, map);
}

function convert(model: string, field: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const t = fieldTypes.get(model)?.get(field);
  switch (t) {
    case "DateTime": {
      if (v instanceof Date) return v;
      if (typeof v === "number") return new Date(v);
      let s = String(v).trim();
      let d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
      if (isNaN(d.getTime())) d = new Date(s); // fallback apa adanya
      if (isNaN(d.getTime())) throw new Error(`DateTime tak terbaca: ${model}.${field}=${s}`);
      return d;
    }
    case "Boolean":
      return v === 1 || v === true || v === "1";
    case "Int":
    case "Float":
      return Number(v);
    default:
      return typeof v === "string" ? v : String(v);
  }
}

let totalSource = 0;
let totalTarget = 0;
const report: string[] = [];

const deleg = (name: string) =>
  (pg as unknown as Record<string, Record<string, (a?: unknown) => Promise<unknown>>>)[name];

// 1) Kosongkan semua tabel (urutan TERBALIK) agar skrip bisa dijalankan ulang
for (const [, delegate] of [...ORDER].reverse()) {
  await deleg(delegate).deleteMany();
}

for (const [model, delegate] of ORDER) {
  const rows = lite.prepare(`SELECT * FROM "${model}"`).all() as Record<string, unknown>[];
  const data = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k] = convert(model, k, v);
    return out;
  });

  const d = deleg(delegate);
  let inserted = 0;
  let skipped = 0;
  const reasons = new Map<string, number>();
  for (const row of data) {
    try {
      await d.create({ data: row });
      inserted++;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const why = err.code === "P2003" ? "orphan-FK" : err.code ?? "error";
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
      skipped++;
    }
  }
  const count = (await d.count()) as number;
  totalSource += rows.length;
  totalTarget += count;
  const whyStr = [...reasons.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
  const line = `${model.padEnd(22)} sumber=${String(rows.length).padStart(4)}  postgres=${String(count).padStart(4)}  skip=${skipped}${whyStr ? ` (${whyStr})` : ""}${rows.length !== count ? "  ⚠️" : ""}`;
  report.push(line);
  console.log(line);
}

console.log("─".repeat(56));
console.log(`TOTAL   sumber=${totalSource}  postgres=${totalTarget}`);

await pg.$disconnect();
lite.close();
void report;

/**
 * SINKRONISASI DELTA: Turso → Prisma Postgres (upsert semua tabel by id)
 * - Baca langsung dari Turso (state terbaru)
 * - Upsert ke DATABASE_URL (Prisma Postgres)
 * - Konversi tipe via DMMF: DateTime string→Date, 0/1→boolean, angka→Number
 * - Aman dijalankan berulang (idempoten); TIDAK menghapus baris yang hanya
 *   ada di tujuan (session/otp lama tidak masalah).
 *
 * Jalankan: bun scripts/sync-turso-to-pg.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { PrismaClient, Prisma } from "@prisma/client";

const ROOT = resolve(import.meta.dirname, "..");
const envText = readFileSync(resolve(ROOT, ".env"), "utf8");
const get = (k) => envText.match(new RegExp(`^${k}="?(.*?)"?$`, "m"))?.[1]?.trim() ?? "";

const turso = createClient({
  url: get("TURSO_DATABASE_URL"),
  authToken: get("TURSO_AUTH_TOKEN"),
});
const pg = new PrismaClient({ log: ["error"] });

// urutan insert aman FK (parent → child)
const ORDER = [
  "User", "Product", "StoreSetting", "PasswordReset", "BiometricChallenge",
  "QrisSandboxTrx", "Session", "PushToken", "BiometricCredential",
  "ChatThread", "ChatMessage", "Order", "OrderItem", "Voucher",
  "VoucherRedemption", "PointTransaction",
];

// peta nama model → delegat prisma (camelCase)
const del = (m) => m[0].toLowerCase() + m.slice(1).replace(/[A-Z]/g, (c) => c.toLowerCase());
// koreksi khusus nama model ganda kata: Prisma delegat = camelCase penuh
const delegate = {
  User: "user", Product: "product", StoreSetting: "storeSetting",
  PasswordReset: "passwordReset", BiometricChallenge: "biometricChallenge",
  QrisSandboxTrx: "qrisSandboxTrx", Session: "session", PushToken: "pushToken",
  BiometricCredential: "biometricCredential", ChatThread: "chatThread",
  ChatMessage: "chatMessage", Order: "order", OrderItem: "orderItem",
  Voucher: "voucher", VoucherRedemption: "voucherRedemption",
  PointTransaction: "pointTransaction",
};

// field DateTime / Boolean / angka per model dari DMMF
const dmmf = {};
for (const m of ORDER) {
  const mm = Prisma.dmmf.datamodel.models.find((x) => x.name === m);
  dmmf[m] = {
    dateTimes: new Set(mm.fields.filter((f) => f.kind === "scalar" && f.type === "DateTime").map((f) => f.name)),
    booleans: new Set(mm.fields.filter((f) => f.kind === "scalar" && f.type === "Boolean").map((f) => f.name)),
    numbers: new Set(
      mm.fields.filter((f) => f.kind === "scalar" && ["Int", "Float", "BigInt"].includes(f.type)).map((f) => f.name)
    ),
  };
}

function toDate(v) {
  if (v instanceof Date) return v;
  let d = new Date(v);
  if (Number.isNaN(d.getTime())) d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) d = new Date(String(v).replace(" ", "T").replace(/ ?\+00:00$/, "Z"));
  if (Number.isNaN(d.getTime())) throw new Error(`tanggal tak terbaca: ${v}`);
  return d;
}

function convert(model, row) {
  const { dateTimes, booleans, numbers } = dmmf[model];
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (dateTimes.has(k)) { out[k] = toDate(v); continue; }
    if (booleans.has(k)) { out[k] = typeof v === "number" ? v !== 0 : Boolean(v); continue; }
    if (numbers.has(k)) { out[k] = Number(v); continue; }
    out[k] = v;
  }
  return out;
}

let created = 0, updated = 0;
for (const model of ORDER) {
  const res = await turso.execute(`SELECT * FROM "${model}"`);
  const d = pg[delegate[model]];
  let c = 0, u = 0;
  for (const raw of res.rows) {
    const data = convert(model, { ...raw });
    const id = data.id ?? data.key; // BiometricChallenge: key = @id
    const where = data.id !== undefined ? { id: data.id } : { key: data.key };
    const existing = await d.findUnique({ where });
    if (existing) {
      await d.update({ where, data });
      u++;
    } else {
      await d.create({ data });
      c++;
    }
  }
  created += c; updated += u;
  console.log(`  ${model.padEnd(20)} dibuat ${String(c).padStart(3)} · diperbarui ${String(u).padStart(3)} · (sumber ${res.rows.length})`);
}
console.log(`\n✓ Sinkron selesai — total dibuat ${created}, diperbarui ${updated}`);
await pg.$disconnect();

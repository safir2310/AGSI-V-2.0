/**
 * verify-pickup-column.mjs — pastikan kolom "pickupAt" ADA di tabel "Order"
 * DB produksi (permintaan fitur jadwal jam pengambilan Bungkus).
 *
 * Cara: ambil DIRECT_DATABASE_URL (fallback DATABASE_URL) dari env Vercel
 * (decrypt=true, token di scripts/.vtoken), lalu jalankan ALTER TABLE ADD
 * COLUMN IF NOT EXISTS via `prisma db execute` — MURNI ADITIF & IDEMPOTENT,
 * identik dengan prisma/sql/014-order-pickup-at.sql (aman berulang).
 * URL TIDAK pernah dicetak ke output.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const VT = readFileSync(new URL("./.vtoken", import.meta.url), "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PROJECT = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const H = { Authorization: `Bearer ${VT}` };

const api = async (path) => {
  const r = await fetch(`https://api.vercel.com${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

const list = await api(`/v9/projects/${PROJECT}/env?teamId=${TEAM}`);
const pick = list.envs?.find((e) => e.key === "DIRECT_DATABASE_URL" && e.target?.includes("production"))
  ?? list.envs?.find((e) => e.key === "DIRECT_DATABASE_URL")
  ?? list.envs?.find((e) => e.key === "DATABASE_URL" && e.target?.includes("production"))
  ?? list.envs?.find((e) => e.key === "DATABASE_URL");
if (!pick) throw new Error("env DATABASE_URL / DIRECT_DATABASE_URL tidak ditemukan");

const one = await api(`/v9/projects/${PROJECT}/env/${pick.id}?teamId=${TEAM}&decrypt=true`);
const url = one.value ?? one.decrypted ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) throw new Error("nilai env bukan URL postgres");

// ALTER idempoten — jalankan lewat prisma db execute (tanpa menampilkan URL)
execFileSync("npx", ["prisma", "db", "execute", "--url", url, "--stdin"], {
  input: `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupAt" TIMESTAMP(3);`,
  stdio: ["pipe", "pipe", "pipe"],
  encoding: "utf8",
});
console.log("OK — kolom Order.pickupAt terjamin ada di DB produksi (ALTER idempoten sukses)");

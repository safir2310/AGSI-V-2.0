/**
 * audit-stores.mjs — audit menyeluruh store Vercel (Prisma Postgres x2, Neon,
 * Turso): status, store mana terhubung ke project produksi agsi, dan tes
 * koneksi ke URL masing-masing (nilai rahasia TIDAK dicetak).
 * Pemakaian: node scripts/audit-stores.mjs  (butuh scripts/.vtoken)
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PROD_PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";

const api = async (path) => {
  const r = await fetch(`https://api.vercel.com/v1${path}${path.includes("?") ? "&" : "?"}teamId=${T}`, {
    headers: { Authorization: `Bearer ${VT}` },
  });
  return r.json();
};

const stores = await api("/storage/stores");
const list = Array.isArray(stores) ? stores : stores.stores ?? [];
const mask = (s) =>
  String(s).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, "postgres://***@").replace(/libsql:\/\/[^@\s]+@/g, "libsql://***@");

for (const s of list) {
  const d = await api(`/storage/stores/${s.id}`);
  const st = d.store ?? d;
  const projs = (st.projectsMetadata ?? []).map((p) => `${p.name}(${p.projectId.slice(0, 12)})`);
  console.log(`\n## ${st.name} [${st.id}]`);
  console.log(`   status=${st.status}  billing=${st.billingState}  plan=${st.billingPlan?.name ?? "?"}  quotaExceeded=${st.usageQuotaExceeded}`);
  console.log(`   updatedAt=${new Date(st.updatedAt).toISOString()}  external=${st.externalResourceStatus ?? "-"}`);
  console.log(`   terhubung ke: ${projs.join(", ") || "(tidak ada)"}${(st.projectsMetadata ?? []).some((p) => p.projectId === PROD_PRJ) ? "  <== PROJECT PRODUKSI!" : ""}`);

  // ambil URL koneksi dari secrets (list atau dict) → tes koneksi
  const secs = st.secrets ?? [];
  const items = Array.isArray(secs) ? secs : Object.entries(secs).map(([name, value]) => ({ name, value }));
  const u = items.find((x) => x.name === "data_DATABASE_URL")?.value ?? items.find((x) => x.name === "DATABASE_URL")?.value;
  if (u && String(u).startsWith("postgres")) {
    const mm = String(u).match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]*)/);
    console.log(`   URL: postgres://***:***@${mm?.[3]}:${mm?.[4]}/${mm?.[5]}  (user=${mm?.[1]})`);
    if (st.status === "suspended") {
      console.log("   → tes koneksi DILEWATI (store suspended, diharapkan gagal)");
    } else {
      await testPg(u, "   ");
    }
  }
}

async function testPg(url, ind) {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url } } });
    const t0 = Date.now();
    const r = await db.$queryRawUnsafe("SELECT 1 AS alive");
    let extra = "";
    try {
      const cnt = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "User"');
      const ord = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "Order"');
      extra = ` | User=${cnt[0]?.n} Order=${ord[0]?.n}`;
    } catch (e) {
      extra = ` | tabel: ${mask(e?.message).slice(0, 80)}`;
    }
    console.log(`${ind}KONEKSI OK (${Date.now() - t0}ms) SELECT 1=${r[0]?.alive}${extra}`);
    await db.$disconnect();
  } catch (e) {
    console.log(`${ind}KONEKSI GAGAL: ${mask(e?.message).slice(0, 160)}`);
  }
}

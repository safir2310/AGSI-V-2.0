/**
 * resend_fresh_start.mjs — TAHAP 1: sapu bersih & bangun domain baru.
 *
 * A) Hapus SEMUA domain lama di akun Resend (semuanya status failed).
 * B) Cek ketersediaan & beli domain baru via registrar Vercel
 *    (DNS otomatis di Vercel → bisa diatur penuh via API).
 * C) Daftarkan domain baru di Resend (region ap-southeast-1).
 * D) Pasang record DNS resmi Resend (DKIM TXT, CNAME rsend, CNAME send)
 *    langsung di Vercel DNS.
 *
 * Kunci: scripts/.rkey (Resend, tidak dicetak), scripts/.vtoken (Vercel, tidak dicetak).
 */
import { readFileSync } from "fs";

const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const NAME = process.argv[2] ?? "ayamgepreksambalijo.com";
const REGION = "ap-southeast-1";

const RH = { Authorization: `Bearer ${RK}` };
const vapi = (path, init = {}) =>
  fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${VT}`, ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// A) hapus semua domain lama
const list = (await (await fetch("https://api.resend.com/domains", { headers: RH })).json()).data ?? [];
console.log(`A) Domain lama di akun Resend (${list.length}): ${list.map((d) => `${d.name}[${d.status}]`).join(", ") || "(kosong)"}`);
for (const d of list) {
  const r = await fetch(`https://api.resend.com/domains/${d.id}`, { method: "DELETE", headers: RH });
  const j = await r.json().catch(() => ({}));
  console.log(`   DELETE ${d.name} → ${r.status} ${r.ok && (j.deleted ?? true) ? "terhapus ✅" : String(j.message ?? "").slice(0, 140)}`);
}

// B) ketersediaan & pembelian
const st = await vapi(`/v4/domains/status?name=${NAME}`);
const avail = st.body?.available;
console.log(`B) ${NAME} tersedia di registrar Vercel: ${avail}`);
if (avail !== true) {
  console.log(`   Detail: ${String(JSON.stringify(st.body)).slice(0, 200)} — STOP, coba nama lain.`);
  process.exit(2);
}
const buy = await vapi("/v4/domains", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: NAME }),
});
if (!buy.ok) {
  console.log(`   BUY → ${buy.status} ❌ ${String(JSON.stringify(buy.body)).slice(0, 220)}`);
  process.exit(3);
}
console.log(`   BUY → ${buy.status} ✅ dibeli (uid=${buy.body?.uid ?? buy.body?.domain?.uid ?? "-"}), menunggu prop, 5s…`);
await new Promise((r) => setTimeout(r, 5000));

// C) daftarkan di Resend
const add = await fetch("https://api.resend.com/domains", {
  method: "POST",
  headers: { ...RH, "Content-Type": "application/json" },
  body: JSON.stringify({ name: NAME, region: REGION }),
});
const addj = await add.json().catch(() => ({}));
if (!(add.status === 200 || add.status === 201)) {
  console.log(`C) POST /domains → ${add.status} ❌ ${String(addj.message ?? "").slice(0, 200)}`);
  process.exit(4);
}
const dom = addj.id ? addj : addj.domain ?? {};
console.log(`C) ${NAME} terdaftar di Resend: id=${dom.id}, region=${dom.region ?? REGION}, status=${dom.status ?? "?"}`);

// D) pasang record DNS di Vercel
for (const rec of dom.records ?? []) {
  const rr = await vapi(`/v4/domains/${NAME}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: rec.type, name: rec.name ?? "", value: rec.value, ttl: 60 }),
  });
  console.log(`D) record ${rec.type} ${rec.name || "@"} → ${rr.status} ${rr.ok ? "OK ✅" : String(JSON.stringify(rr.body)).slice(0, 200)}`);
}
console.log(`\nTAHAP 1 SELESAI — lanjut: node scripts/resend_verify_new.mjs ${NAME}`);

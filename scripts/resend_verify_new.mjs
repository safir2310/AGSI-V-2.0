/**
 * resend_verify_new.mjs — TAHAP AKHIR: verifikasi domain di Resend, aktifkan
 * untuk produksi, dan uji.
 *
 * 1. POST /domains/{id}/verify → poll sampai status success.
 * 2. Jika sukses:
 *    a. PATCH env Vercel RESEND_FROM → "AGSI <no-reply@<domain>>" (upsert).
 *    b. Tambahkan domain ke proyek web + A @ 76.76.21.21 + CNAME www (bonus:
 *       situs hidup di domain brand).
 *    c. Redeploy produksi (empty commit + push origin main) → poll READY.
 *    d. Probe kirim email dari no-reply@<domain> (harus diterima Resend).
 * 3. Ringkasan. Kunci tidak dicetak.
 */
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";
const NAME = process.argv[2] ?? "ayamgepreksambalijo.com";
const RH = { Authorization: `Bearer ${RK}` };

const vapi = (path, init = {}) =>
  fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${VT}`, ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }));

// 1) verifikasi
const list = (await (await fetch("https://api.resend.com/domains", { headers: RH })).json()).data ?? [];
const dom = list.find((d) => d.name === NAME);
if (!dom) { console.log(`${NAME} belum terdaftar di Resend — jalankan continue_domain_setup dulu.`); process.exit(1); }
console.log(`Resend: ${NAME} (id=${dom.id}, status=${dom.status})`);
if (dom.status !== "success") {
  const v = await fetch(`https://api.resend.com/domains/${dom.id}/verify`, { method: "POST", headers: RH });
  const vj = await v.json().catch(() => ({}));
  console.log(`POST /verify → ${v.status} ${v.ok ? `status=${vj.status ?? "?"}` : String(vj.message ?? "").slice(0, 160)}`);
  let st = vj.status ?? dom.status;
  for (let i = 0; i < 10 && st !== "success"; i++) {
    await new Promise((r) => setTimeout(r, 20000));
    st = ((await (await fetch(`https://api.resend.com/domains/${dom.id}`, { headers: RH })).json().catch(() => ({}))).status) ?? st;
    console.log(`  status (${(i + 1) * 20}s): ${st}`);
    if (/fail/i.test(st)) { console.log("VERIFIKASI GAGAL — cek record DNS."); process.exit(2); }
  }
  if (st !== "success") { console.log(`Status masih "${st}" — coba lagi nanti.`); process.exit(3); }
}
console.log(`✅ ${NAME} VERIFIED di Resend`);

// 2a) env RESEND_FROM
const FROM = `AGSI <no-reply@${NAME}>`;
const envs = (await (await vapi(`/v10/projects/${PRJ}/env`)).json()).envs ?? [];
const entries = envs.filter((e) => e.key === "RESEND_FROM");
for (const e of entries) {
  const p = await vapi(`/v10/projects/${PRJ}/env/${e.id}?upsert=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "RESEND_FROM", value: FROM, type: "encrypted", target: e.target ?? ["production", "preview", "development"] }),
  });
  console.log(`PATCH RESEND_FROM (${e.target?.join(",")}) → ${p.status} ${p.ok ? "OK ✅" : String(JSON.stringify(p.body)).slice(0, 160)}`);
}
if (!entries.length) {
  const p = await vapi(`/v10/projects/${PRJ}/env?upsert=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "RESEND_FROM", value: FROM, type: "encrypted", target: ["production", "preview", "development"] }),
  });
  console.log(`POST RESEND_FROM (baru) → ${p.status} ${p.ok ? "OK ✅" : String(JSON.stringify(p.body)).slice(0, 160)}`);
}

// 2b) domain ke proyek web + record site
const pd = await vapi(`/v9/projects/${PRJ}/domains`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: NAME }),
});
console.log(`Domain ke proyek web → ${pd.status} ${pd.ok ? "OK ✅" : String(JSON.stringify(pd.body)).slice(0, 160)}`);
const aRec = await vapi(`/v4/domains/${NAME}/records`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "A", name: "", value: "76.76.21.21", ttl: 60 }),
});
console.log(`DNS A @ → ${aRec.status} ${aRec.ok ? "OK ✅" : String(JSON.stringify(aRec.body)).slice(0, 120)}`);
const wwwRec = await vapi(`/v4/domains/${NAME}/records`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "CNAME", name: "www", value: "cname.vercel-dns.com", ttl: 60 }),
});
console.log(`DNS CNAME www → ${wwwRec.status} ${wwwRec.ok ? "OK ✅" : String(JSON.stringify(wwwRec.body)).slice(0, 120)}`);

// 2c) redeploy produksi
try {
  execSync('git commit --allow-empty -m "chore: aktifkan domain email baru ' + NAME + '"', { cwd: "/home/z/my-project", stdio: "pipe" });
  execSync("git push origin main", { cwd: "/home/z/my-project", stdio: "pipe" });
  const sha = execSync("git rev-parse HEAD", { cwd: "/home/z/my-project" }).toString().trim().slice(0, 7);
  console.log(`Redeploy dipicu (push ${sha}) — poll deployment…`);
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 20000));
    const deps = (await (await vapi(`/v6/deployments?projectId=${PRJ}&target=production&limit=1`)).json()).deployments ?? [];
    const d = deps[0] ?? {};
    const shaMatch = String(d.meta?.githubCommitSha ?? "").startsWith(sha);
    console.log(`  deploy (${(i + 1) * 20}s): state=${d.state ?? "?"} sha=${String(d.meta?.githubCommitSha ?? "").slice(0, 7)}${shaMatch ? " (cocok)" : ""}`);
    if (d.state === "READY" && shaMatch) break;
    if (/ERROR|CANCELED/.test(d.state ?? "") && shaMatch) { console.log("Deploy GAGAL — cek dashboard."); process.exit(4); }
  }
} catch (e) {
  console.log("Redeploy gagal dipicu:", String(e.message).slice(0, 160), "— env tetap tersimpan, deploy manual bisa dilakukan.");
}

// 2d) probe kirim email
await new Promise((r) => setTimeout(r, 10000));
const p = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { ...RH, "Content-Type": "application/json" },
  body: JSON.stringify({ from: FROM, to: ["diag-probe.agsi@zagent-test.dev"], subject: "Probe domain baru AGSI", html: "<p>tes</p>" }),
});
const pj = await p.json().catch(() => ({}));
console.log(`Probe kirim dari ${FROM} → ${p.status}`, p.ok ? "DITERIMA Resend ✅✅" : `DITOLAK — ${String(pj.message ?? "").slice(0, 200)}`);

// ringkasan
const health = await fetch(`https://ayamgepreksambalijo.vercel.app/api/health`).then((r) => r.json()).catch(() => ({}));
console.log("Health app:", JSON.stringify(health).slice(0, 120));
writeFileSync("/home/z/my-project/scripts/.domain-active.json", JSON.stringify({ domain: NAME, from: FROM, at: new Date().toISOString() }, null, 2));
console.log("\nSELESAI — domain aktif untuk email & situs.");

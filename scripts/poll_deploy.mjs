/**
 * poll_deploy.mjs — poll deployment produksi terbaru sampai READY + health check.
 */
import { readFileSync } from "fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";
const vapi = (p) => fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`, { headers: { Authorization: `Bearer ${VT}` } }).then((r) => r.json());

let state = "?";
for (let i = 0; i < 27; i++) {
  await new Promise((r) => setTimeout(r, 20000));
  const d = ((await vapi(`/v6/deployments?projectId=${PRJ}&target=production&limit=1`)).deployments ?? [])[0] ?? {};
  state = d.state ?? "?";
  console.log(`  deploy (${(i + 1) * 20}s): state=${state} sha=${String(d.meta?.githubCommitSha ?? "").slice(0, 7)} msg=${String(d.meta?.githubCommitMessage ?? "").slice(0, 50)}`);
  if (state === "READY") break;
  if (/ERROR|CANCELED/.test(state)) { console.log("Deploy GAGAL — cek dashboard Vercel."); process.exit(1); }
}
if (state !== "READY") { console.log(`Deployment masih "${state}" — cek lagi nanti.`); process.exit(2); }
console.log("Deploy READY ✅");
const h = await fetch("https://ayamgepreksambalijo.vercel.app/api/health").then((r) => r.json()).catch(() => ({}));
console.log("Health:", JSON.stringify(h).slice(0, 200));

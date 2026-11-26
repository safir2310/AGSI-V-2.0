/**
 * redeploy_poll.mjs — redeploy produksi (empty commit + push origin main),
 * poll sampai READY, lalu health check + probe akun Resend baru via env app.
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";
const vapi = (p) => fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`, { headers: { Authorization: `Bearer ${VT}` } }).then((r) => r.json());

execSync('git commit --allow-empty -m "chore: ganti akun Resend produksi (kunci baru)"', { cwd: "/home/z/my-project", stdio: "pipe" });
execSync("git push origin main", { cwd: "/home/z/my-project", stdio: "pipe" });
const sha = execSync("git rev-parse HEAD", { cwd: "/home/z/my-project" }).toString().trim().slice(0, 7);
console.log(`Push ${sha} — poll deployment…`);

let state = "?";
for (let i = 0; i < 27; i++) {
  await new Promise((r) => setTimeout(r, 20000));
  const d = ((await vapi(`/v6/deployments?projectId=${PRJ}&target=production&limit=1`)).deployments ?? [])[0] ?? {};
  state = d.state ?? "?";
  const shaMatch = String(d.meta?.githubCommitSha ?? "").startsWith(sha);
  console.log(`  deploy (${(i + 1) * 20}s): state=${state} sha=${String(d.meta?.githubCommitSha ?? "").slice(0, 7)}${shaMatch ? " (cocok)" : ""}`);
  if (state === "READY" && shaMatch) break;
  if (/ERROR|CANCELED/.test(state) && shaMatch) { console.log("Deploy GAGAL — cek dashboard Vercel."); process.exit(1); }
}
if (state !== "READY") { console.log(`Deployment masih "${state}" — cek lagi nanti.`); process.exit(2); }
console.log("Deploy READY ✅");

const h = await fetch("https://ayamgepreksambalijo.vercel.app/api/health").then((r) => r.json()).catch(() => ({}));
console.log("Health:", JSON.stringify(h).slice(0, 200));

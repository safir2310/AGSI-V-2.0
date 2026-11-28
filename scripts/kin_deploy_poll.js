// Poll status deploy Vercel untuk satu commit sampai READY/ERROR/CANCELED.
// Token dibaca dari scripts/.vtoken (JANGAN pernah dicetak).
// Pakai: node scripts/kin_deploy_poll.js <prefix_sha> [maks_poll] [interval_dtk]
const fs = require("fs");

const sha = process.argv[2];
if (!sha) {
  console.error("pakai: node scripts/kin_deploy_poll.js <prefix_sha> [maks_poll] [interval_dtk]");
  process.exit(2);
}
const maxPolls = Number(process.argv[3] || 16);
const interval = Number(process.argv[4] || 30);
const token = fs.readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const base =
  "https://api.vercel.com/v6/deployments?teamId=team_gSL83YS5Iip6SdjlzMr9gWvR" +
  "&projectId=prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK&limit=6&target=production";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 1; i <= maxPolls; i++) {
    let dep;
    try {
      const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        console.log(`poll ${i}: HTTP ${res.status}`);
      } else {
        const data = await res.json();
        dep = (data.deployments || []).find((d) => (d.meta?.githubCommitSha || "").startsWith(sha));
        if (!dep) {
          console.log(`poll ${i}: deployment untuk ${sha} belum muncul`);
        } else {
          console.log(
            `poll ${i}: state=${dep.readyState} uid=${dep.uid} umur=${Math.round((Date.now() - dep.created) / 1000)} dtk`
          );
          if (["READY", "ERROR", "CANCELED"].includes(dep.readyState)) {
            console.log(`FINAL: ${dep.readyState} (url=${dep.url})`);
            process.exit(dep.readyState === "READY" ? 0 : 1);
          }
        }
      }
    } catch (e) {
      console.log(`poll ${i}: gagal fetch (${e.message})`);
    }
    await sleep(interval * 1000);
  }
  console.log("FINAL: TIMEOUT — belum READY dalam batas polling");
  process.exit(1);
})();

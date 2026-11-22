/**
 * env-diag-130.mjs — cek env di level PROYEK dan level TIM, hapus WHATSAPP_*
 * di mana pun ditemukan. Hanya nama env yang dicetak (nilai tidak).
 */
import { readFileSync } from "fs";

const VT = readFileSync("scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PROJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const base = "https://api.vercel.com";

const get = async (path) => {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${VT}` } });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const del = async (path) => {
  const res = await fetch(`${base}${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${VT}` } });
  return res.status;
};

const main = async () => {
  const p = await get(`/v9/projects/${PROJ}/env?teamId=${TEAM}`);
  console.log("PROYEK /v9 env:", p.status, p.json.error ? JSON.stringify(p.json.error) : (p.json.envs ?? []).map((e) => e.key).join(", "));

  for (const path of [`/v2/teams/${TEAM}/envs`, `/v1/teams/${TEAM}/envs`]) {
    const t = await get(path);
    if (t.status === 200) {
      const envs = t.json.envs ?? t.json.data ?? [];
      console.log(`TIM ${path}:`, envs.map((e) => e.key).join(", "));
      for (const e of envs.filter((e) => e.key.startsWith("WHATSAPP_"))) {
        console.log(`  hapus ${e.key} (tim):`, await del(`${path}/${e.id}`));
      }
    } else {
      console.log(`TIM ${path}:`, t.status, t.json.error?.code ?? "");
    }
  }

  // hapus WHATSAPP_* di level proyek (bila ada)
  const p2 = await get(`/v9/projects/${PROJ}/env?teamId=${TEAM}`);
  for (const e of (p2.json.envs ?? []).filter((e) => e.key.startsWith("WHATSAPP_"))) {
    console.log(`  hapus ${e.key} (proyek):`, await del(`/v9/projects/${PROJ}/env/${e.id}?teamId=${TEAM}`));
  }
  const p3 = await get(`/v9/projects/${PROJ}/env?teamId=${TEAM}`);
  console.log("PROYEK env akhir:", p3.status, (p3.json.envs ?? []).map((e) => e.key).join(", "));
};

main();

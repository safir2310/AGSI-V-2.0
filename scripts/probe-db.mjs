/** probe-db.mjs — identifikasi file .dburl-* mana yang database produksi AGSI */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/z/my-project/package.json");
const { Client } = require("pg");

for (const f of [".dburl-neon", ".dburl-prisma-blue"]) {
  try {
    const url = readFileSync(`/home/z/my-project/scripts/${f}`, "utf8").trim();
    const host = new URL(url).hostname;
    const conn = url.replace(/([?&])sslmode=require&?/g, (s) => (s.startsWith("?") ? "?" : "")).replace(/\?$/, "");
    const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    await c.connect();
    const u = await c.query('SELECT COUNT(*)::int AS n FROM "User"');
    const own = await c.query("SELECT email, role FROM \"User\" WHERE email IN ('2310musafir@gmail.com','musafir1023@gmail.com')");
    const t = await c.query('SELECT COUNT(*)::int AS n FROM "PushToken"');
    console.log(`${f} → host=${host} users=${u.rows[0].n} pushTokens=${t.rows[0].n} owner-rows=${JSON.stringify(own.rows)}`);
    await c.end();
  } catch (e) {
    console.log(`${f} → GAGAL: ${e.message?.slice(0, 90)}`);
  }
}

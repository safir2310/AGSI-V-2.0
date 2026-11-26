// inspect-turso.mjs — cek isi database Turso (pink-kettle) via REST API libsql.
// Token & URL dibaca dari /tmp/sec-pinkkettle.json (tidak dicetak).
// Pakai: node scripts/inspect-turso.mjs
const creds = JSON.parse((await import("node:fs")).readFileSync("/tmp/sec-pinkkettle.json", "utf8"));
const url = creds.data_TURSO_DATABASE_URL.replace("libsql://", "https://");
const token = creds.data_TURSO_AUTH_TOKEN;

async function q(sql) {
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ statements: [sql] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return r.json();
}

try {
  const res = await q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
  const tables = res.results?.[0]?.response?.result?.rows?.map((r) => r[0]?.value ?? r[0]) ?? [];
  console.log("TABEL Turso (%d): %s", tables.length, tables.join(", ") || "(kosong)");
  for (const t of tables) {
    if (t.startsWith("sqlite_") || t.startsWith("_turso")) continue;
    try {
      const c = await q(`SELECT COUNT(*) FROM "${t}";`);
      const n = c.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value;
      if (Number(n) > 0) console.log(`  ${t}: ${n} baris`);
    } catch (e) {
      console.log(`  ${t}: gagal hitung (${e.message.slice(0, 60)})`);
    }
  }
} catch (e) {
  console.log("✗ gagal:", e.message.split("\n")[0]);
}
